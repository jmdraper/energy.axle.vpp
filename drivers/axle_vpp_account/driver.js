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

  }

  // ─── Pairing ──────────────────────────────────────────────────────────────

  async onPair(session) {
    session.setHandler('validate', async ({ token }) => {
      await this._testToken(token);
      return { ok: true };
    });
  }

  // ─── Repair (update API token on an existing device) ──────────────────────

  async onRepair(session, device) {
    session.setHandler('validate', async ({ token }) => {
      await this._testToken(token);
      return { ok: true };
    });

    session.setHandler('save_token', async ({ token }) => {
      await this._testToken(token);
      await device.updateApiToken(token);
      return { ok: true };
    });
  }

  // ─── Shared helpers ────────────────────────────────────────────────────────

  async _testToken(token) {
    if (!token || !token.trim()) {
      throw new Error(this.homey.__('pair.error_empty_token'));
    }
    const client = new AxleApiClient({
      token: token.trim(),
      log: this.log.bind(this),
      error: this.error.bind(this),
    });
    await client.testConnection();
  }

}

module.exports = AxleVppDriver;
