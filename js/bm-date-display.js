/* Display only: API/storage and legacy numeric date keys keep their existing formats. */
(function(window) {
    'use strict';
    const zone = 'Asia/Bangkok';
    const calendar = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {timeZone:zone, day:'numeric', month:'short', year:'numeric'});
    const clock = new Intl.DateTimeFormat('en-GB', {timeZone:zone, hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
    function wallDate(year, month, day, hour = 0, minute = 0, second = 0) {
        const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
        if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
        return new Date(check.getTime() - 7 * 3600000);
    }
    function parse(value) {
        if (value instanceof Date) return isNaN(value.getTime()) ? null : {date:value, timed:true};
        const input = String(value || '').trim();
        let match = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
        if (match) { const date = wallDate(+match[1], +match[2], +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0)); return date && {date, timed:Boolean(match[4])}; }
        match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (match) { let year = match[3].length === 2 ? 2000 + Number(match[3]) : +match[3]; if (year >= 2400) year -= 543; const date = wallDate(year, +match[2], +match[1], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0)); return date && {date, timed:Boolean(match[4])}; }
        match = input.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/);
        if (match && wallDate(+match[1], +match[2], +match[3], +match[4], +match[5], +(match[6] || 0))) {
            const date = new Date(input); return isNaN(date.getTime()) ? null : {date, timed:true};
        }
        return null;
    }
    function format(value, withTime) {
        const parsed = parse(value); if (!parsed) return value == null ? '' : String(value);
        return calendar.format(parsed.date) + (withTime && parsed.timed ? ' - ' + clock.format(parsed.date) : '');
    }
    window.BMDateDisplay = Object.freeze({date:value => format(value, false), dateTime:value => format(value, true)});
})(window);
