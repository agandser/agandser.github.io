(function () {
  "use strict";

  if (!window.Lampa || !Lampa.Player || !Lampa.Activity) return;

  var OSV3 = "https://opensubtitles-v3.strem.io/";
  var IMPORT_PREFIX = "★ OS";
  var cache = Object.create(null); // key -> Promise|Array

  // --- lang helpers ---
  function normLang(code) {
    if (!code) return "";
    code = String(code).toLowerCase();

    // OSv3 часто ISO-639-2 (3 буквы)
    if (code === "eng" || code === "en") return "en";
    if (code === "rus" || code === "ru") return "ru";

    // если уже 2 буквы
    if (/^[a-z]{2}$/.test(code)) return code;

    return ""; // остальное не берём (чтобы не плодить мусор)
  }

  function prettyLang(n) {
    if (n === "ru") return "Русский";
    if (n === "en") return "English";
    return "Sub";
  }

  function getPreferredLang() {
    var lang = "";
    try {
      lang = String(Lampa.Storage.get("language") || Lampa.Storage.field("language") || "").toLowerCase();
    } catch (e) {}
    if (lang.indexOf("ru") !== -1) return "ru";
    if (lang.indexOf("en") !== -1) return "en";
    return "";
  }

  // --- fetch ---
  function fetchSubs(imdb, season, episode) {
    var key = imdb + "_" + (season == null ? "m" : season) + "_" + (episode == null ? "m" : episode);
    if (cache[key]) return Promise.resolve(cache[key]).then(function (v) { return v; });

    var isSeries = season != null && episode != null;
    var url = isSeries
      ? OSV3 + "subtitles/series/" + imdb + ":" + season + ":" + episode + ".json"
      : OSV3 + "subtitles/movie/" + imdb + ".json";

    // дедупим одновременные запросы: кладём Promise
    cache[key] = fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var list = (j && j.subtitles && Array.isArray(j.subtitles)) ? j.subtitles : [];
        cache[key] = list;
        return list;
      })
      .catch(function (e) {
        console.log("[os-sub] fetch failed", e);
        cache[key] = [];
        return [];
      });

    return cache[key];
  }

  // --- wait pack ---
  function waitForReady(timeoutMs) {
    timeoutMs = timeoutMs || 6000;

    var start = Date.now();
    return new Promise(function (resolve) {
      (function tick() {
        var activity = null, playdata = null, movie = null;
        try { activity = Lampa.Activity.active(); } catch (e) {}
        try { playdata = Lampa.Player.playdata(); } catch (e2) {}
        try { movie = activity && activity.movie; } catch (e3) {}

        if (activity && playdata && movie) return resolve({ activity: activity, playdata: playdata, movie: movie });

        if (Date.now() - start >= timeoutMs) return resolve(null);
        setTimeout(tick, 250);
      })();
    });
  }

  // --- ranking (чтобы выбрать 1 лучший) ---
  function scoreItem(s) {
    var score = 0;

    // если есть кодировка — предпочитаем UTF
    var enc = (s && s.SubEncoding) ? String(s.SubEncoding).toLowerCase() : "";
    if (enc.indexOf("utf") !== -1) score += 100;

    // предпочитаем vtt/srt
    var url = (s && s.url) ? String(s.url).toLowerCase() : "";
    if (url.indexOf(".vtt") !== -1) score += 50;
    if (url.indexOf(".srt") !== -1) score += 30;

    // если вдруг есть “score/rating/downloads” — подхватим
    if (typeof s.score === "number") score += s.score;
    if (typeof s.downloads === "number") score += Math.min(200, s.downloads / 10);

    return score;
  }

  function buildLabel(osItem, nlang) {
    var parts = [IMPORT_PREFIX, prettyLang(nlang)];

    if (osItem && osItem.SubEncoding) {
      parts.push(String(osItem.SubEncoding).toUpperCase());
    }

    // короткий id чтобы отличать, но не спамить
    if (osItem && osItem.id) parts.push("#" + osItem.id);

    return parts.join(" · ");
  }

  function uniqByUrl(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !it.url) continue;
      var exists = false;
      for (var j = 0; j < out.length; j++) {
        if (out[j].url === it.url) { exists = true; break; }
      }
      if (!exists) out.push(it);
    }
    return out;
  }

  // --- main ---
  function setupSubs() {
    return waitForReady(6500).then(function (pack) {
      if (!pack) return;

      var playdata = pack.playdata;
      var movie = pack.movie;

      var imdb = movie.imdb_id || movie.imdb;
      if (!imdb || !/^tt\d+/.test(imdb)) {
        console.log("[os-sub] no imdb_id, skip", { title: movie.title || movie.name, imdb: imdb });
        return;
      }

      var isSeries = (playdata.season != null && playdata.episode != null);
      var season = isSeries ? Number(playdata.season) : undefined;
      var episode = isSeries ? Number(playdata.episode) : undefined;

      // текущие сабы (что уже есть)
      var current = [];
      var src = playdata.subtitles || [];
      for (var i = 0; i < src.length; i++) {
        var s = src[i];
        if (!s || !s.url) continue;
        current.push({
          label: s.label || s.lang || "Sub",
          url: s.url,
          lang: normLang(s.lang),
          _imported: false
        });
      }
      current = uniqByUrl(current);

      // какие языки уже есть — чтобы не дублировать импортом
      var hasLang = { ru: false, en: false };
      for (var k = 0; k < current.length; k++) {
        if (current[k].lang === "ru") hasLang.ru = true;
        if (current[k].lang === "en") hasLang.en = true;
      }

      return fetchSubs(imdb, season, episode).then(function (osList) {
        osList = osList || [];

        // собираем кандидатов только ru/en
        var cand = { ru: [], en: [] };

        for (var i2 = 0; i2 < osList.length; i2++) {
          var it = osList[i2];
          if (!it || !it.url) continue;

          var nlang = normLang(it.lang);
          if (nlang !== "ru" && nlang !== "en") continue;

          // если такой язык уже есть в текущих — НЕ добавляем импорт (меньше мусора)
          if (nlang === "ru" && hasLang.ru) continue;
          if (nlang === "en" && hasLang.en) continue;

          cand[nlang].push(it);
        }

        // выбираем 1 лучший на язык
        function pickBest(arr) {
          if (!arr || !arr.length) return null;
          arr.sort(function (a, b) { return scoreItem(b) - scoreItem(a); });
          return arr[0];
        }

        var bestRu = pickBest(cand.ru);
        var bestEn = pickBest(cand.en);

        var imported = [];
        if (bestRu) imported.push({
          label: buildLabel(bestRu, "ru"),
          url: bestRu.url,
          lang: "ru",
          _imported: true
        });
        if (bestEn) imported.push({
          label: buildLabel(bestEn, "en"),
          url: bestEn.url,
          lang: "en",
          _imported: true
        });

        // мерджим
        var all = uniqByUrl(current.concat(imported));

        if (!all.length) return;

        // выбор по умолчанию: предпочитаемый язык интерфейса,
        // сначала НЕимпортированный, потом импортированный
        var pref = getPreferredLang();
        var idx = 0;

        if (pref) {
          var iNon = -1, iImp = -1;
          for (var z = 0; z < all.length; z++) {
            if (all[z].lang === pref && !all[z]._imported && iNon === -1) iNon = z;
            if (all[z].lang === pref && all[z]._imported && iImp === -1) iImp = z;
          }
          idx = (iNon !== -1) ? iNon : (iImp !== -1 ? iImp : 0);
        }

        console.log("[os-sub] subtitles final:", all);
        Lampa.Player.subtitles(all, idx);
      });
    });
  }

  // запуск на старте плеера
  Lampa.Player.listener.follow("start", function () {
    setTimeout(setupSubs, 800);
  });
})();
