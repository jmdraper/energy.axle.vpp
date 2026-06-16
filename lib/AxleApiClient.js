'use strict';

const https = require('https');

const API_HOST = 'api.axle.energy';
const EVENT_PATH = '/vpp/home-assistant/event';
const REQUEST_TIMEOUT_MS = 15000;

class AxleApiClient {

  constructor({ token, log, error }) {
    this._token = token;
    this.log = log || (() => {});
    this.error = error || (() => {});
  }

  setToken(token) {
    this._token = token;
  }

  /**
   * Fetch the current VPP event from the Axle API.
   * @returns {Promise<Object|null>} Event data or null when no event is scheduled.
   * @throws {Error} 'UNAUTHORIZED' | 'SERVER_ERROR' | 'TIMEOUT' | 'PARSE_ERROR'
   */
  getEvent() {
    return this._get(EVENT_PATH);
  }

  async testConnection() {
    await this._get(EVENT_PATH);
    return true;
  }

  _get(path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: API_HOST,
        path,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this._token}`,
          Accept: 'application/json',
          'User-Agent': 'HomeyAxleVPP/1.0',
        },
      };

      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          const { statusCode } = res;

          if (statusCode === 401 || statusCode === 403) {
            return reject(new Error('UNAUTHORIZED'));
          }
          if (statusCode >= 500) {
            return reject(new Error(`SERVER_ERROR:${statusCode}`));
          }
          if (statusCode === 204 || raw.trim() === '' || raw.trim() === 'null') {
            return resolve(null);
          }
          if (statusCode !== 200) {
            return reject(new Error(`HTTP_ERROR:${statusCode}`));
          }

          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error('PARSE_ERROR'));
          }
        });
      });

      req.on('error', reject);

      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error('TIMEOUT'));
      });

      req.end();
    });
  }

}

module.exports = AxleApiClient;
