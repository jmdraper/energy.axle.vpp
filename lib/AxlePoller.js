'use strict';

/**
 * Dynamic polling coordinator. Mirrors HA's DataUpdateCoordinator:
 *   - Normal (no nearby event):  poll_interval_normal (default 10 min)
 *   - Pre-event / in-progress:   poll_interval_active (default 60 sec)
 *
 * Scheduling uses Homey's setTimeout so the timer is properly managed by
 * Homey's runtime and survives app restarts.
 */
class AxlePoller {

  constructor({ device, client, log, error }) {
    this._device = device;
    this._client = client;
    this.log = log || (() => {});
    this.error = error || (() => {});
    this._timer = null;
    this._running = false;
    this._polling = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.log('Poller started');
    this._scheduleNext(0);
  }

  stop() {
    this._running = false;
    this._clearTimer();
    this.log('Poller stopped');
  }

  /** Force an immediate poll and reset the schedule. */
  async poll() {
    if (this._polling) return;
    this._clearTimer();
    this._polling = true;
    try {
      this.log('Polling Axle API');
      const data = await this._client.getEvent();
      await this._device.onEventData(data);
    } catch (err) {
      await this._device.onPollError(err);
    } finally {
      this._polling = false;
    }
    if (this._running) {
      this._scheduleNext(this._getIntervalMs());
    }
  }

  /** Restart the schedule after a settings change. */
  reschedule() {
    if (!this._running) return;
    this._clearTimer();
    this._scheduleNext(this._getIntervalMs());
  }

  _getIntervalMs() {
    const settings = this._device.getSettings();
    const normalMs = (settings.poll_interval_normal || 10) * 60 * 1000;
    const activeMs = (settings.poll_interval_active || 60) * 1000;
    const windowHours = settings.pre_event_window_hours || 2;

    const startIso = this._device.getStoreValue('eventStartTime');
    const endIso = this._device.getStoreValue('eventEndTime');

    if (startIso && endIso) {
      const now = Date.now();
      const start = new Date(startIso).getTime();
      const end = new Date(endIso).getTime();

      if (now >= start && now < end) return activeMs;

      const windowMs = windowHours * 60 * 60 * 1000;
      if (start > now && (start - now) <= windowMs) return activeMs;
    }

    return normalMs;
  }

  _scheduleNext(delayMs) {
    this._timer = this._device.homey.setTimeout(() => {
      this._timer = null;
      this.poll();
    }, delayMs);
  }

  _clearTimer() {
    if (this._timer) {
      this._device.homey.clearTimeout(this._timer);
      this._timer = null;
    }
  }

}

module.exports = AxlePoller;
