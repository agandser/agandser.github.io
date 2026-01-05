(function () {
  "use strict";

  if (!window.Lampa || !Lampa.Player) return;
  if (window.lampa_ultimate_skip_v2) return;
  window.lampa_ultimate_skip_v2 = true;

  // -----------------------------
  // Config
  // -----------------------------
  var CFG = {
    // Ждём таймкоды максимум столько, потом запускаем видео в любом случае
    MAX_WAIT_MS: 900,

    // Показывать уведомления
    SHOW_NOTY: false,

    // Кэш (дней)
    MAL_CACHE_DAYS: 30,
    SEG_CACHE_DAYS: 14,

    // ВЫРЕЗАЕМ скип для не-аниме сериалов (как ты попросил)
    ANIME_ONLY: true
  };

  var ANISKIP_API = "https://api.aniskip.com/v2/skip-times";
  var JIKAN_API = "https://api.jikan.moe/v4/anime";
  var SKIP_TYPES = ["op", "ed", "recap"];

  // -----------------------------
  // Small helpers
  // -----------------------------
  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function now() {
    return Date.now();
  }

  function daysToMs(days) {
    return days * 24 * 60 * 60 * 1000;
  }

  function safeNoty(text) {
    try {
      if (!CFG.SHOW_NOTY) return;
      if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(text);
    } catch (e) {}
  }

  function fetchJson(url, timeoutMs) {
    timeoutMs = timeoutMs || 4500;

    if (typeof AbortController === "undefined") {
      // TV-браузеры иногда без AbortController
      return fetch(url).then(function (r) { return r.json(); });
    }

    var controller = new AbortController();
    var t = setTimeout(function () {
      try { controller.abort(); } catch (e) {}
    }, timeoutMs);

    return fetch(url, { signal: controller.signal })
      .then(function (r) {
        clearTimeout(t);
        return r.json();
      })
      .catch(function (e) {
        clearTimeout(t);
        throw e;
      });
  }

  // -----------------------------
  // Cache (localStorage)
  // -----------------------------
  var CACHE_KEY = "ultimate_skip_cache_v2";

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return { mal: {}, seg: {} };
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return { mal: {}, seg: {} };
      obj.mal = obj.mal || {};
      obj.seg = obj.seg || {};
      return obj;
    } catch (e) {
      return { mal: {}, seg: {} };
    }
  }

  function saveCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  function cacheGet(cache, bucket, key) {
    try {
      var v = cache[bucket] && cache[bucket][key];
      if (!v) return null;
      if (v.exp && v.exp < now()) return null;
      return v.val || null;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(cache, bucket, key, val, ttlMs) {
    try {
      cache[bucket] = cache[bucket] || {};
      cache[bucket][key] = { val: val, exp: now() + ttlMs };
      saveCache(cache);
    } catch (e) {}
  }

  // -----------------------------
  // Detection
  // -----------------------------
  function isTrailerTitle(title) {
    title = (title || "").toLowerCase();
    return ["трейлер", "trailer", "тизер", "teaser"].some(function (k) {
      return title.indexOf(k) !== -1;
    });
  }

  function isAnimeCard(card) {
    if (!card) return false;

    var lang = (card.original_language || "").toLowerCase();
    var isAsianLang = (lang === "ja" || lang === "zh" || lang === "cn" || lang === "ko");

    var isAnimation = false;
    try {
      isAnimation = !!(card.genres && card.genres.some(function (g) {
        return g && (g.id === 16 || (g.name && String(g.name).toLowerCase() === "animation"));
      }));
    } catch (e) {}

    // У аниме часто origin_country JP, но это не всегда в tmdb ответе
    var isJP = false;
    try {
      if (Array.isArray(card.origin_country)) {
        isJP = card.origin_country.indexOf("JP") !== -1;
      }
    } catch (e) {}

    return isAsianLang || isAnimation || isJP;
  }

  function cleanAnimeTitle(card) {
    var t = card.original_name || card.original_title || card.name || card.title || "";
    t = String(t);

    return t
      .replace(/\(\d{4}\)/g, "")
      .replace(/\(TV\)/gi, "")
      .replace(/Season\s+\d+/gi, "")
      .replace(/Part\s+\d+/gi, "")
      .replace(/[:\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getReleaseYear(card) {
    var y = (card.release_date || card.first_air_date || "0000").slice(0, 4);
    return y && y !== "0000" ? y : "";
  }

  function detectPosition(videoParams, defaultSeason) {
    defaultSeason = defaultSeason || 1;

    // Прямые параметры
    var ep = videoParams.episode || videoParams.e || videoParams.episode_number || videoParams.episodeNumber;
    var se = videoParams.season || videoParams.s || videoParams.season_number || videoParams.seasonNumber;

    if (ep) {
      return {
        season: parseInt(se || defaultSeason, 10),
        episode: parseInt(ep, 10)
      };
    }

    // Плейлист: ищем текущий url
    if (videoParams.playlist && Array.isArray(videoParams.playlist) && videoParams.url) {
      var idx = videoParams.playlist.findIndex(function (p) { return p && p.url === videoParams.url; });
      if (idx !== -1) {
        var it = videoParams.playlist[idx] || {};
        return {
          season: parseInt(it.season || it.s || defaultSeason, 10),
          episode: parseInt(it.episode || it.e || it.episode_number || (idx + 1), 10)
        };
      }
    }

    return { season: defaultSeason, episode: 1 };
  }

  // -----------------------------
  // Apply segments into params + playlist
  // -----------------------------
  function addSegmentsToItem(item, newSegments) {
    if (!item || typeof item !== "object") return 0;

    item.segments = item.segments || {};
    item.segments.skip = item.segments.skip || [];

    var count = 0;
    newSegments.forEach(function (ns) {
      var exists = item.segments.skip.some(function (s) { return s.start === ns.start; });
      if (!exists) {
        item.segments.skip.push({
          start: ns.start,
          end: ns.end,
          name: ns.name || "Пропустить"
        });
        count++;
      }
    });

    return count;
  }

  function updatePlaylist(playlist, season, episode, segments) {
    if (!playlist || !Array.isArray(playlist)) return;

    playlist.forEach(function (item, index) {
      var itemSeason = item.season || item.s || season;
      var itemEpisode = item.episode || item.e || item.episode_number || (index + 1);

      if (parseInt(itemEpisode, 10) === parseInt(episode, 10) &&
          parseInt(itemSeason, 10) === parseInt(season, 10)) {
        addSegmentsToItem(item, segments);
      }
    });
  }

  // -----------------------------
  // Jikan -> MAL id
  // -----------------------------
  function pickMalFromJikan(data, season, year) {
    if (!data || !data.data || !data.data.length) return null;

    // 1) Совпадение по году для 1 сезона (если есть)
    if (year && season === 1) {
      var matchYear = data.data.find(function (it) {
        var y = it.year;
        if (!y && it.aired && it.aired.from) y = String(it.aired.from).slice(0, 4);
        return String(y) === String(year);
      });
      if (matchYear) return matchYear.mal_id;
    }

    // 2) Если season > 1 — пытаемся найти по ключевым словам
    if (season > 1) {
      var ord =
        season + (
          (season % 10 === 1 && season !== 11) ? "st" :
          (season % 10 === 2 && season !== 12) ? "nd" :
          (season % 10 === 3 && season !== 13) ? "rd" : "th"
        );

      var keywords = ["season " + season, ord + " season", "season" + season];

      var titleMatch = data.data.find(function (it) {
        var titles = [it.title, it.title_english].concat(it.title_synonyms || [])
          .filter(Boolean)
          .map(function (t) { return String(t).toLowerCase(); });

        return titles.some(function (t) {
          return keywords.some(function (k) { return t.indexOf(k) !== -1; });
        });
      });

      if (titleMatch) return titleMatch.mal_id;
    }

    // 3) Фоллбек: первый
    return data.data[0].mal_id;
  }

  async function getMalId(title, season, year, cache) {
    var key = [title, season, year].join("|").toLowerCase();
    var cached = cacheGet(cache, "mal", key);
    if (cached) return cached;

    var query = title;
    if (season > 1) query += " Season " + season;

    var url = JIKAN_API + "?q=" + encodeURIComponent(query) + "&limit=10";

    // Jikan иногда лимитит — делаем 1 мягкий ретрай
    try {
      var json = await fetchJson(url, 5000);
      var mal = pickMalFromJikan(json, season, year);
      if (mal) cacheSet(cache, "mal", key, mal, daysToMs(CFG.MAL_CACHE_DAYS));
      return mal;
    } catch (e1) {
      try {
        await sleep(700);
        var json2 = await fetchJson(url, 5000);
        var mal2 = pickMalFromJikan(json2, season, year);
        if (mal2) cacheSet(cache, "mal", key, mal2, daysToMs(CFG.MAL_CACHE_DAYS));
        return mal2;
      } catch (e2) {
        return null;
      }
    }
  }

  // -----------------------------
  // AniSkip -> segments
  // -----------------------------
  function normalizeAniSkip(raw) {
    if (!raw || !raw.length) return [];

    var out = [];
    raw.forEach(function (s) {
      if (!s || !s.interval) return;

      var type = String(s.skipType || s.skip_type || "").toLowerCase();
      var name = "Пропустить";
      if (type.indexOf("op") !== -1) name = "Опенинг";
      else if (type.indexOf("ed") !== -1) name = "Эндинг";
      else if (type === "recap") name = "Рекап";

      var start = (s.interval.startTime !== undefined) ? s.interval.startTime : s.interval.start_time;
      var end = (s.interval.endTime !== undefined) ? s.interval.endTime : s.interval.end_time;

      start = Number(start);
      end = Number(end);

      if (!isFinite(start) || !isFinite(end)) return;
      if (end <= start) return;

      out.push({ start: start, end: end, name: name });
    });

    // убираем дубли по start
    var uniq = [];
    out.forEach(function (seg) {
      if (!uniq.some(function (u) { return u.start === seg.start; })) uniq.push(seg);
    });

    return uniq;
  }

  async function getAniSkipSegments(malId, episode, cache) {
    var key = String(malId) + ":" + String(episode);
    var cached = cacheGet(cache, "seg", key);
    if (cached) return cached;

    var types = SKIP_TYPES.map(function (t) { return "types=" + t; });
    types.push("episodeLength=0");
    var url = ANISKIP_API + "/" + encodeURIComponent(malId) + "/" + encodeURIComponent(episode) + "?" + types.join("&");

    try {
      var res = await fetch(url);
      if (res.status === 404) return [];
      var json = await res.json();

      var raw = (json && json.found && json.results && json.results.length) ? json.results : [];
      var segs = normalizeAniSkip(raw);

      if (segs.length) cacheSet(cache, "seg", key, segs, daysToMs(CFG.SEG_CACHE_DAYS));
      return segs;
    } catch (e) {
      return [];
    }
  }

  // -----------------------------
  // Main logic
  // -----------------------------
  async function searchAndApply(videoParams) {
    if (!videoParams || videoParams.__ultimate_skip_applied) return;
    videoParams.__ultimate_skip_applied = true;

    // card/movie context
    var card = videoParams.movie || videoParams.card;
    if (!card) {
      try {
        var active = Lampa.Activity.active();
        if (active) card = active.movie || active.card;
      } catch (e) {}
    }
    if (!card) return;

    // не работаем на трейлерах
    var t = videoParams.title || card.title || card.name || "";
    if (isTrailerTitle(t)) return;

    // ВЫРЕЗ: не-аниме сериалы/контент
    if (CFG.ANIME_ONLY && !isAnimeCard(card)) return;

    var isSerial = !!(card.number_of_seasons > 0 || (card.original_name && !card.original_title));
    var pos = detectPosition(videoParams, 1);

    var season = isSerial ? (pos.season || 1) : 1;
    var episode = isSerial ? (pos.episode || 1) : 1;

    var title = cleanAnimeTitle(card);
    if (!title) return;

    var year = getReleaseYear(card);

    var cache = loadCache();

    var malId = await getMalId(title, season, year, cache);
    if (!malId) return;

    var segs = await getAniSkipSegments(malId, episode, cache);
    if (!segs || !segs.length) return;

    // apply to current params
    videoParams.segments = videoParams.segments || {};
    videoParams.segments.skip = videoParams.segments.skip || [];

    segs.forEach(function (seg) {
      var exists = videoParams.segments.skip.some(function (s) { return s.start === seg.start; });
      if (!exists) videoParams.segments.skip.push(seg);
    });

    // apply to playlist item (если есть)
    updatePlaylist(videoParams.playlist, season, episode, segs);

    safeNoty("Таймкоды загружены: S" + season + "E" + episode);
  }

  // -----------------------------
  // Hook player
  // -----------------------------
  var originalPlay = Lampa.Player.play;
  var originalPlaylist = Lampa.Player.playlist;
  var pendingPlaylist = null;

  Lampa.Player.playlist = function (playlist) {
    pendingPlaylist = playlist;
    return originalPlaylist.call(this, playlist);
  };

  Lampa.Player.play = function (videoParams) {
    var ctx = this;
    var done = false;

    function go() {
      if (done) return;
      done = true;

      try { originalPlay.call(ctx, videoParams); }
      catch (e) { try { originalPlay.call(ctx, videoParams); } catch (e2) {} }

      // восстановление плейлиста, как в твоём исходнике
      if (pendingPlaylist) {
        try { Lampa.PlayerPlaylist.set(pendingPlaylist); } catch (e3) {}
        pendingPlaylist = null;
      }
    }

    // синхронизируем url/playlist в PlayerPlaylist (как было)
    try { if (videoParams && videoParams.url) Lampa.PlayerPlaylist.url(videoParams.url); } catch (e4) {}
    try { if (videoParams && videoParams.playlist && videoParams.playlist.length) Lampa.PlayerPlaylist.set(videoParams.playlist); } catch (e5) {}

    // ждём таймкоды, но не дольше MAX_WAIT_MS
    Promise.race([
      searchAndApply(videoParams).catch(function () {}),
      sleep(CFG.MAX_WAIT_MS)
    ]).then(go).catch(go);
  };

  // На всякий — отметим в консоли
  try { console.log("[ultimate_skip_v2] loaded (anime only)"); } catch (e) {}
})();
