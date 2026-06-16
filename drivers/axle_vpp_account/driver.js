'use strict';

const { Driver } = require('homey');
const AxleApiClient = require('../../lib/AxleApiClient');

class AxleVppDriver extends Driver {

  async onInit() {
    this.log('AxleVppDriver initialised');
    this._registerFlowHandlers();
  }

  // ─── Flow card run-listener registration ──────────────────────────────────

  _registerFlowHandlers() {
    this.homey.flow
      .getConditionCard('event_is_in_progress')
      .registerRunListener(async (args) => args.device.isEventInProgress());

    this.homey.flow
      .getConditionCard('event_is_upcoming')
      .registerRunListener(async (args) => args.device.isEventUpcoming());

    this.homey.flow
      .getConditionCard('event_within_minutes')
      .registerRunListener(async (args) =>
        args.device.isEventWithinMinutes(parseInt(args.minutes, 10)));

    this.homey.flow
      .getConditionCard('event_completed_today')
      .registerRunListener(async (args) => args.device.isEventCompletedToday());

    this.homey.flow
      .getActionCard('force_poll')
      .registerRunListener(async (args) => args.device.forcePoll());

    this.homey.flow
      .getActionCard('set_opt_out')
      .registerRunListener(async (args) => args.device.setOptOut());

    this.homey.flow
      .getActionCard('log_event_note')
      .registerRunListener(async (args) => args.device.logEventNote(args.note));
  }

  // ─── Pairing ──────────────────────────────────────────────────────────────

  async onPair(session) {
    session.setHandler('validate', async ({ token }) => {
      if (!token || !token.trim()) {
        throw new Error(this.homey.__('pair.error_empty_token'));
      }
      const client = new AxleApiClient({
        token: token.trim(),
        log: this.log.bind(this),
        error: this.error.bind(this),
      });
      await client.testConnection();
      return { ok: true };
    });
  }


}

module.exports = AxleVppDriver;
