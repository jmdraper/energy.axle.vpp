'use strict';

const { Device } = require('homey');
const AxleApiClient = require('../../lib/AxleApiClient');
const AxlePoller = require('../../lib/AxlePoller');


class AxleVppDevice extends Device {

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async onInit() {
    this.log('AxleVppDevice onInit');

    const token = this.getStoreValue('apiToken');
    if (!token) {
      await this.setUnavailable(this.homey.__('error.no_token'));
      return;
    }

    this._client = new AxleApiClient({
      token,
      log: this.log.bind(this),
      error: this.error.bind(this),
    });

    this._poller = new AxlePoller({
      device: this,
      client: this._client,
      log: this.log.bind(this),
      error: this.error.bind(this),
    });

    // Per-event one-shot trigger flags (reset when a new event cycle begins)
    this._triggered1h = false;
    this._triggered2h = false;
    this._triggeredTomorrow = false;
    this._eventCompletedToday = false;
    this._lastState = null;

    // Trigger card references (fired from device, registered in driver)
    this._triggerEventStarted = this.homey.flow.getDeviceTriggerCard('event_started');
    this._triggerEventEnded = this.homey.flow.getDeviceTriggerCard('event_ended');
    this._triggerEventUpcoming1h = this.homey.flow.getDeviceTriggerCard('event_upcoming_1h');
    this._triggerEventUpcoming2h = this.homey.flow.getDeviceTriggerCard('event_upcoming_2h');
    this._triggerEventScheduledTomorrow = this.homey.flow.getDeviceTriggerCard('event_scheduled_tomorrow');
    this._triggerEventStateChanged = this.homey.flow.getDeviceTriggerCard('event_state_changed');

    // Countdown tick: updates axle_minutes_to_start / axle_minutes_remaining every minute
    this._countdownInterval = this.homey.setInterval(
      () => this._tickCountdowns(),
      60 * 1000,
    );

    this._scheduleMidnightReset();
    this._poller.start();
  }

  async onUninit() {
    this._poller && this._poller.stop();
    this._countdownInterval && this.homey.clearInterval(this._countdownInterval);
    this._midnightTimer && this.homey.clearTimeout(this._midnightTimer);
    this._midnightInterval && this.homey.clearInterval(this._midnightInterval);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('apiToken') && newSettings.apiToken) {
      const token = newSettings.apiToken.trim();
      await this.setStoreValue('apiToken', token);
      this._client.setToken(token);
      await this.setAvailable();
      await this._poller.poll();
      return;
    }

    const pollKeys = ['poll_interval_normal', 'poll_interval_active', 'pre_event_window_hours'];
    if (changedKeys.some((k) => pollKeys.includes(k))) {
      this._poller.reschedule();
    }
  }

  // ─── Public API for flow card handlers in driver.js ───────────────────────

  isEventInProgress() {
    return this.getCapabilityValue('axle_event_state') === 'in_progress';
  }

  isEventUpcoming() {
    return this.getCapabilityValue('axle_event_state') === 'upcoming';
  }

  isEventWithinMinutes(minutes) {
    const state = this.getCapabilityValue('axle_event_state');
    const minsToStart = this.getCapabilityValue('axle_minutes_to_start');
    return state === 'upcoming' && minsToStart !== null && minsToStart <= minutes;
  }

  isEventCompletedToday() {
    return this._eventCompletedToday;
  }

  async forcePoll() {
    await this._poller.poll();
  }

  // ─── Data callbacks from AxlePoller ───────────────────────────────────────

  /**
   * Called by AxlePoller after every successful API fetch.
   * @param {Object|null} data  Raw API response or null (no event)
   */
  async onEventData(data) {
    await this.setAvailable();

    const now = new Date();
    let newState;
    let startTime = null;
    let endTime = null;
    let direction = 'export';

    if (data && data.start_time && data.end_time) {
      startTime = new Date(data.start_time);
      endTime = new Date(data.end_time);
      direction = data.import_export || 'export';

      if (now >= endTime) {
        newState = 'finished';
      } else if (now >= startTime) {
        newState = 'in_progress';
      } else {
        newState = 'upcoming';
      }
    } else {
      newState = 'none';
    }

    const prevState = this._lastState;

    // Reset per-event flags when a fresh upcoming event appears
    if (newState === 'upcoming' && prevState !== 'upcoming') {
      this._triggered1h = false;
      this._triggered2h = false;
      this._triggeredTomorrow = false;
    }

    await this._applyState(newState, startTime, endTime, data);

    // prevState === null means first load after restart: establish state silently
    if (prevState !== null && prevState !== newState) {
      await this._triggerEventStateChanged
        .trigger(this, { new_state: newState })
        .catch(this.error.bind(this));

      if (newState === 'in_progress') {
        const durationMin = startTime && endTime
          ? Math.round((endTime - startTime) / 60000)
          : 0;
        await this._triggerEventStarted
          .trigger(this, { duration_minutes: durationMin, export_direction: direction })
          .catch(this.error.bind(this));
      }

      if (newState === 'finished' && prevState === 'in_progress') {
        await this._handleEventEnd(data);
      }
    }

    // "Scheduled for tomorrow" check (fires once per event)
    if (newState === 'upcoming' && startTime && !this._triggeredTomorrow) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (startTime.toDateString() === tomorrow.toDateString()) {
        this._triggeredTomorrow = true;
        const label = this._fmtTime(startTime) + ' tomorrow';
        await this._triggerEventScheduledTomorrow
          .trigger(this, { start_time: label })
          .catch(this.error.bind(this));
      }
    }

    // Persist event window timestamps for AxlePoller's interval calculation
    await this.setStoreValue('eventStartTime', startTime ? startTime.toISOString() : null);
    await this.setStoreValue('eventEndTime', endTime ? endTime.toISOString() : null);

    // Immediate countdown tick (no need to wait 60 s for first values)
    this._tickCountdowns();
  }

  async onPollError(err) {
    this.error('Poll error:', err.message);
    if (err.message === 'UNAUTHORIZED') {
      await this.setUnavailable(this.homey.__('error.unauthorized'));
    } else {
      await this.setUnavailable(this.homey.__('error.api_error'));
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  async _applyState(state, startTime, endTime, data) {
    this._lastState = state;

    await this.setCapabilityValue('axle_event_state', state).catch(this.error.bind(this));
    await this.setCapabilityValue('alarm_generic', state === 'in_progress').catch(this.error.bind(this));

    if (state === 'none' || state === 'finished') {
      await this.setCapabilityValue('axle_minutes_to_start', null).catch(this.error.bind(this));
      await this.setCapabilityValue('axle_minutes_remaining', null).catch(this.error.bind(this));
    }

    if (data && typeof data.earnings_month === 'number') {
      await this.setCapabilityValue('axle_earnings_month', data.earnings_month)
        .catch(this.error.bind(this));
    }
  }

  async _handleEventEnd(data) {
    this._eventCompletedToday = true;

    await this._triggerEventEnded
      .trigger(this, {})
      .catch(this.error.bind(this));

    const kwhExported = (data && typeof data.kwh_exported === 'number') ? data.kwh_exported : 0;
    if (kwhExported > 0) {
      const current = this.getStoreValue('totalKwhExported') || 0;
      const total = parseFloat((current + kwhExported).toFixed(3));
      await this.setStoreValue('totalKwhExported', total);
      await this.setCapabilityValue('meter_power', total).catch(this.error.bind(this));
    }

    if (data && typeof data.earnings_month === 'number') {
      await this.setCapabilityValue('axle_earnings_month', data.earnings_month)
        .catch(this.error.bind(this));
    }
  }

  _tickCountdowns() {
    const now = Date.now();
    const state = this.getCapabilityValue('axle_event_state');
    const startIso = this.getStoreValue('eventStartTime');
    const endIso = this.getStoreValue('eventEndTime');

    if (state === 'upcoming' && startIso) {
      const start = new Date(startIso).getTime();
      const minsToStart = Math.max(0, Math.round((start - now) / 60000));

      this.setCapabilityValue('axle_minutes_to_start', minsToStart)
        .catch(this.error.bind(this));

      if (minsToStart <= 60 && !this._triggered1h) {
        this._triggered1h = true;
        this._triggerEventUpcoming1h.trigger(this, {
          start_time: this._fmtTime(startIso),
          minutes_to_start: minsToStart,
        }).catch(this.error.bind(this));
      }

      if (minsToStart <= 120 && !this._triggered2h) {
        this._triggered2h = true;
        this._triggerEventUpcoming2h.trigger(this, {
          start_time: this._fmtTime(startIso),
          minutes_to_start: minsToStart,
        }).catch(this.error.bind(this));
      }
    }

    if (state === 'in_progress' && endIso) {
      const end = new Date(endIso).getTime();
      const minsRemaining = Math.max(0, Math.round((end - now) / 60000));
      this.setCapabilityValue('axle_minutes_remaining', minsRemaining)
        .catch(this.error.bind(this));
    }
  }

  _scheduleMidnightReset() {
    const now = new Date();
    const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0) - now;

    this._midnightTimer = this.homey.setTimeout(() => {
      this._resetDailyState();
      this._midnightInterval = this.homey.setInterval(
        () => this._resetDailyState(),
        24 * 60 * 60 * 1000,
      );
    }, msUntilMidnight);
  }

  _resetDailyState() {
    this.log('Midnight reset: clearing daily state');
    this._eventCompletedToday = false;
    this._triggeredTomorrow = false;
    this._triggered1h = false;
    this._triggered2h = false;
  }

  _fmtTime(date) {
    return new Date(date).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: this.homey.clock.getTimezone(),
    });
  }

}

module.exports = AxleVppDevice;
