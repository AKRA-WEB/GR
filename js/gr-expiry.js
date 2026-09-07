// GR Expiry Date Normalization & Ambiguity Resolution
// Supports Thai/English text, Thai numerals, BE/CE 4-digit years, and provides explicit ambiguity resolution

(function(global) {
  'use strict';

  const THAI_MONTH_NAMES = [
    '', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  const THAI_MONTH_SHORT = [
    '', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  function normalizeDigits(str) {
    if (!str) return '';
    return str.replace(/[๐-๙]/g, ch => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(ch)));
  }

  function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  function maxDaysInMonth(year, month) {
    if (month < 1 || month > 12) return 0;
    if (month === 2) return isLeapYear(year) ? 29 : 28;
    if ([4, 6, 9, 11].includes(month)) return 30;
    return 31;
  }

  function isValidCalendarDate(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
    if (month < 1 || month > 12) return false;
    const max = maxDaysInMonth(year, month);
    return day >= 1 && day <= max;
  }

  function formatIso(year, month, day) {
    const y = String(year).padStart(4, '0');
    const m = String(month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatThaiPreview(yearCE, month, day) {
    const yearBE = yearCE + 543;
    const monthName = THAI_MONTH_NAMES[month] || '';
    const iso = formatIso(yearCE, month, day);
    return `${day} ${monthName} ${yearBE} (${iso})`;
  }

  function detectMonth(str) {
    const s = str.trim();
    const thaiMonths = [
      { num: 1, regex: /(?:มกราคม|ม\.ค\.)/i },
      { num: 2, regex: /(?:กุมภาพันธ์|ก\.พ\.)/i },
      { num: 3, regex: /(?:มีนาคม|มี\.ค\.)/i },
      { num: 4, regex: /(?:เมษายน|เม\.ย\.)/i },
      { num: 5, regex: /(?:พฤษภาคม|พ\.ค\.)/i },
      { num: 6, regex: /(?:มิถุนายน|มิ\.ย\.)/i },
      { num: 7, regex: /(?:กรกฎาคม|ก\.ค\.)/i },
      { num: 8, regex: /(?:สิงหาคม|ส\.ค\.)/i },
      { num: 9, regex: /(?:กันยายน|ก\.ย\.)/i },
      { num: 10, regex: /(?:ตุลาคม|ต\.ค\.)/i },
      { num: 11, regex: /(?:พฤศจิกายน|พ\.ย\.)/i },
      { num: 12, regex: /(?:ธันวาคม|ธ\.ค\.)/i }
    ];

    for (const m of thaiMonths) {
      if (m.regex.test(s)) {
        return {
          month: m.num,
          isThai: true,
          cleaned: s.replace(m.regex, ` ${String(m.num).padStart(2, '0')} `)
        };
      }
    }

    const engMonths = [
      { num: 1, regex: /\b(?:january|jan)\b/i },
      { num: 2, regex: /\b(?:february|feb)\b/i },
      { num: 3, regex: /\b(?:march|mar)\b/i },
      { num: 4, regex: /\b(?:april|apr)\b/i },
      { num: 5, regex: /\b(?:may)\b/i },
      { num: 6, regex: /\b(?:june|jun)\b/i },
      { num: 7, regex: /\b(?:july|jul)\b/i },
      { num: 8, regex: /\b(?:august|aug)\b/i },
      { num: 9, regex: /\b(?:september|sept|sep)\b/i },
      { num: 10, regex: /\b(?:october|oct)\b/i },
      { num: 11, regex: /\b(?:november|nov)\b/i },
      { num: 12, regex: /\b(?:december|dec)\b/i }
    ];

    for (const m of engMonths) {
      if (m.regex.test(s)) {
        return {
          month: m.num,
          isThai: false,
          cleaned: s.replace(m.regex, ` ${String(m.num).padStart(2, '0')} `)
        };
      }
    }

    return null;
  }

  function parseExpiryInput(input) {
    if (input === null || input === undefined) {
      return { isEmpty: true, valid: true, iso: '', previewText: '', candidates: [] };
    }

    const raw = String(input).trim();
    if (!raw) {
      return { isEmpty: true, valid: true, iso: '', previewText: '', candidates: [] };
    }

    // Normalize Thai numerals
    let text = normalizeDigits(raw);

    // Check for explicit BE/CE era markers
    let hasExplicitBE = false;
    let hasExplicitCE = false;
    if (/(?:พ\.?ศ\.?|\b(?:b\.?e\.?)\b)/i.test(text)) {
      hasExplicitBE = true;
      text = text.replace(/(?:พ\.?ศ\.?|\b(?:b\.?e\.?)\b)/gi, ' ');
    }
    if (/(?:ค\.?ศ\.?|\b(?:c\.?e\.?|a\.?d\.?)\b)/i.test(text)) {
      hasExplicitCE = true;
      text = text.replace(/(?:ค\.?ศ\.?|\b(?:c\.?e\.?|a\.?d\.?)\b)/gi, ' ');
    }

    // Month text detection
    const monthMatch = detectMonth(text);
    let monthFromName = null;
    let isThaiMonth = false;
    if (monthMatch) {
      monthFromName = monthMatch.month;
      isThaiMonth = monthMatch.isThai;
      text = monthMatch.cleaned;
    }

    // Clean delimiters and spaces
    text = text.replace(/[,;]/g, ' ');
    text = text.replace(/\s+/g, ' ').trim();

    // Check for incomplete: month/year only (e.g. 12/2026, 2026, 12/2569)
    if (/^\d{1,2}[-/. ]\d{4}$/.test(text) || /^\d{4}$/.test(text)) {
      return {
        isEmpty: false,
        valid: false,
        incomplete: true,
        error: 'กรุณาระบุวันที่ให้ครบถ้วน (เช่น 31/12/2026)',
        candidates: []
      };
    }

    // Numbers extraction
    let day = null;
    let month = monthFromName;
    let year = null;
    let hasShortYear = false;

    // Check Pattern 1: ISO YYYY-MM-DD
    const isoMatch = text.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/);
    if (isoMatch) {
      year = parseInt(isoMatch[1], 10);
      month = parseInt(isoMatch[2], 10);
      day = parseInt(isoMatch[3], 10);
    }

    // Check Pattern 2: Day Month Year (with 4-digit year)
    if (!year) {
      const dmyMatch = text.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/);
      if (dmyMatch) {
        // If month name was detected e.g. "December 31, 2026" -> normalized to "12 31 2026"
        const n1 = parseInt(dmyMatch[1], 10);
        const n2 = parseInt(dmyMatch[2], 10);
        const n3 = parseInt(dmyMatch[3], 10);
        if (monthFromName && n1 <= 12 && n2 > 12) {
          // Month Day Year
          month = n1;
          day = n2;
        } else {
          // Day Month Year (Thai standard)
          day = n1;
          month = n2;
        }
        year = n3;
      }
    }

    // Check Pattern 3: Compact 8-digit
    if (!year) {
      const compactMatch = text.match(/^(\d{8})$/);
      if (compactMatch) {
        const str = compactMatch[1];
        const leading4 = parseInt(str.slice(0, 4), 10);
        const trailing4 = parseInt(str.slice(4, 8), 10);
        if (leading4 >= 1900 && leading4 <= 2799) {
          year = leading4;
          month = parseInt(str.slice(4, 6), 10);
          day = parseInt(str.slice(6, 8), 10);
        } else if (trailing4 >= 1900 && trailing4 <= 2799) {
          day = parseInt(str.slice(0, 2), 10);
          month = parseInt(str.slice(2, 4), 10);
          year = trailing4;
        }
      }
    }

    // Check Pattern 4: 2-digit year (e.g. 31/12/69, 31 ธ.ค. 69, 31/12/26)
    if (!year) {
      const shortMatch = text.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2})$/);
      if (shortMatch) {
        day = parseInt(shortMatch[1], 10);
        month = parseInt(shortMatch[2], 10);
        const shortYear = parseInt(shortMatch[3], 10);
        hasShortYear = true;

        // If Thai month name was used (e.g. 31 ธ.ค. 69) or explicit BE marker, year is unambiguously Buddhist era 25xx
        if (isThaiMonth || hasExplicitBE) {
          year = 2500 + shortYear;
        } else if (hasExplicitCE) {
          year = 2000 + shortYear;
        } else {
          // Pure numbers with 2-digit year (e.g. 31/12/69 or 31/12/26 or 03/04/26)
          // Build candidate list for user choice
          const candidates = [];

          // Candidate 1: BE interpretation (2500 + shortYear) -> CE = 2500 + shortYear - 543
          const yearBE = 2500 + shortYear;
          const yearCE_from_BE = yearBE - 543;
          if (isValidCalendarDate(yearCE_from_BE, month, day)) {
            candidates.push({
              iso: formatIso(yearCE_from_BE, month, day),
              label: `พ.ศ. ${yearBE} (ค.ศ. ${yearCE_from_BE})`,
              preview: formatThaiPreview(yearCE_from_BE, month, day),
              day, month, yearCE: yearCE_from_BE, yearBE
            });
          }

          // Candidate 2: CE interpretation (2000 + shortYear) -> BE = 2000 + shortYear + 543
          const yearCE_from_CE = 2000 + shortYear;
          const yearBE_from_CE = yearCE_from_CE + 543;
          if (isValidCalendarDate(yearCE_from_CE, month, day)) {
            candidates.push({
              iso: formatIso(yearCE_from_CE, month, day),
              label: `ค.ศ. ${yearCE_from_CE} (พ.ศ. ${yearBE_from_CE})`,
              preview: formatThaiPreview(yearCE_from_CE, month, day),
              day, month, yearCE: yearCE_from_CE, yearBE: yearBE_from_CE
            });
          }

          // If day <= 12 and month <= 12 and day !== month, also offer swapped day/month
          if (day <= 12 && month <= 12 && day !== month) {
            if (isValidCalendarDate(yearCE_from_BE, day, month)) {
              candidates.push({
                iso: formatIso(yearCE_from_BE, day, month),
                label: `${month}/${day} พ.ศ. ${yearBE}`,
                preview: formatThaiPreview(yearCE_from_BE, day, month),
                day: month, month: day, yearCE: yearCE_from_BE, yearBE
              });
            }
          }

          return {
            isEmpty: false,
            valid: false,
            ambiguous: true,
            rawInput: raw,
            candidates,
            error: 'ปีหรือวันที่กำกวม โปรดเลือกความหมายที่ถูกต้อง'
          };
        }
      }
    }

    if (!year || !month || !day) {
      return {
        isEmpty: false,
        valid: false,
        error: 'รูปแบบวันที่ไม่ถูกต้อง (ตัวอย่าง: 31/12/2026 หรือ 31/12/2569)',
        candidates: []
      };
    }

    // Convert Buddhist Era to Gregorian CE
    let yearCE = year;
    if (year >= 2400 && year <= 2799) {
      yearCE = year - 543;
    } else if (year < 1900 || year > 2199) {
      return {
        isEmpty: false,
        valid: false,
        error: `ปี ${year} อยู่นอกช่วงที่รองรับ (รองรับ ค.ศ. 1900-2199 หรือ พ.ศ. 2400-2799)`,
        candidates: []
      };
    }

    // Validate actual calendar date
    if (!isValidCalendarDate(yearCE, month, day)) {
      if (month === 2 && day === 29) {
        return {
          isEmpty: false,
          valid: false,
          error: `ปี ${yearCE} (พ.ศ. ${yearCE + 543}) กุมภาพันธ์มี 28 วัน (ไม่ใช่ปีอธิกสุรทิน)`,
          candidates: []
        };
      }
      return {
        isEmpty: false,
        valid: false,
        error: `วันที่ไม่ถูกต้อง (${day} ${THAI_MONTH_NAMES[month] || month} ไม่มีในปฏิทิน)`,
        candidates: []
      };
    }

    const iso = formatIso(yearCE, month, day);
    const previewText = formatThaiPreview(yearCE, month, day);

    return {
      isEmpty: false,
      valid: true,
      ambiguous: false,
      iso,
      day,
      month,
      yearCE,
      yearBE: yearCE + 543,
      previewText,
      candidates: []
    };
  }

  const GrExpiry = {
    normalizeDigits,
    isLeapYear,
    maxDaysInMonth,
    isValidCalendarDate,
    formatIso,
    formatThaiPreview,
    parseExpiryInput,
    THAI_MONTH_NAMES,
    THAI_MONTH_SHORT
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GrExpiry;
  } else {
    global.GrExpiry = GrExpiry;
  }
})(typeof window !== 'undefined' ? window : globalThis);
