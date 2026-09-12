'use strict';

/**
 * Builds the epoch/date/relative-date flow tokens shared by the grid event
 * triggers. Relative to "now", so callers must invoke this fresh for every
 * trigger fire rather than caching the result.
 *
 * @param {Object} homey - the device's `this.homey`
 * @param {Date} startDate
 * @param {Date} endDate
 */
function buildEventTimeTokens(homey, startDate, endDate) {
  const tz = homey.clock.getTimezone();
  const now = Date.now();
  const startEpoch = startDate.getTime();
  const endEpoch = endDate.getTime();

  const ymd = (d) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
    return `${p.year}-${p.month}-${p.day}`;
  };
  const dayNum = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };

  const eventYMD = ymd(startDate);
  const diff = dayNum(eventYMD) - dayNum(ymd(new Date(now)));
  const relativeDate = diff <= 0 ? 'today' : diff === 1 ? 'tomorrow' : 'future';

  return {
    start_epoch: startEpoch,
    end_epoch: endEpoch,
    minutes_to_start: Math.max(0, Math.round((startEpoch - now) / 60000)),
    minutes_to_end: Math.max(0, Math.round((endEpoch - now) / 60000)),
    date: eventYMD,
    relative_date: relativeDate,
  };
}

module.exports = { buildEventTimeTokens };
