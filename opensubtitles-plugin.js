(function () {
  "use strict";

  if (!window.Lampa || !Lampa.Player || !Lampa.Activity) return;

  const OSV3 = "https://opensubtitles-v3.strem.io/";
  const cache = Object.create(null);

  const IMPORT_PREFIX = "★ OS";

  // Нормализуем язык до 2-буквенного только там, где это полезно (ru/en),
  // иначе оставляем как есть (нужно для отображения и фильтров).
  function normLang(code) {
    if (!code) return "";
    code = String(code).toLowerCase();

    // OpenSubtitles v3 обычно отдаёт ISO-639-2 (3 буквы): rus/eng/spa/...
    if (code === "eng" || code === "en") return "en";
    if (code === "rus" || code === "ru") return "ru";

    // иногда встречаются ISO-639-1
    if (/^[a-z]{2}$/.test(code)) return code;

    // оставляем 3-буквенный как есть
    if (/^[a-z]{3}$/.test(code)) return code;

    return "";
  }

  // Человеческие названия (покроем популярные, остальное — fallback)
  const LANG_NAME = {
    ru: "Русский",
    en: "English",
    uk: "Українська",
    be: "Беларуская",
    kk: "Қазақша",
    de: "Deutsch",
    ger: "Deutsch",
    fr: "Français",
    fre: "Français",
    es: "Español",
    spa: "Español",
    it: "Italiano",
    ita: "Italiano",
    pt: "Português",
    por: "Português",
    pob: "Português (BR)",
    tr: "Türkçe",
    tur: "Türkçe",
    pl: "Polski",
    pol: "Polski",
    nl: "Nederlands",
    nld: "Nederlands",
    sv: "Svenska",
    swe: "Svenska",
    da: "Dansk",
    dan: "Dansk",
    fi: "Suomi",
    fin: "Suomi",
    el: "Ελληνικά",
    ell: "Ελληνικά",
    cs: "Čeština",
    ces: "Čeština",
    sk: "Slovenčina",
    slk: "Slovenčina",
    hu: "Magyar",
    hun: "Magyar",
    ro: "Română",
    ron: "Română",
    bg: "Български",
    bul: "Български",
    sr: "Српски",
    hrv: "Hrvatski",
    hr: "Hrvatski",
    ar: "العربية",
    ara: "العربية",
    hi: "हिन्दी",
    hin: "हिन्दी",
    ja: "日本語",
    jpn: "日本語",
    ko: "한국어",
    kor: "한국어",
    zh: "中文",
    zho: "中文",
    cn: "中文",
  };

  function prettyLang(code) {
    const n = normLang(code) || String(code || "").toLowerCase();
    if (!n) return "Sub";
    return LANG_NAME[n] || (n.length <= 3 ? n.toUpperCase() : "Sub");
  }

  function getPreferredLang() {
    // В Лампе обычно language = "ru"/"en"/...
    let lang = "";
    try {
      lang = (Lampa.Storage.get("language") || Lampa.Storage.field("language") || "").toLowerCase();
    } catch (e) {}

    if (lang.includes("ru")) return "ru";
    if (lang.includes("en")) return "en";
    return ""; // без жёсткого дефолта
  }

  async function fetchSubs(imdb, season, episode) {
    const key = `${imdb}_${season ?? "m"}_${episode ?? "m"}`;
    if (cache[key]) return cache[key];

    const isSeries = season != null && episode != null;
    const url = isSeries
      ? `${OSV3}subtitles/series/${imdb}:${season}:${episode}.json`
      : `${OSV3}subtitles/movie/${imdb}.json`;

    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      const list = (j && j.subtitles) ? j.subtitles : [];
      cache[key] = list;
      return list;
    } catch (e) {
      console.log("[os-sub] fetch failed", e);
      cache[key] = [];
      return [];
    }
  }

  async function waitForReady(timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const activity = Lampa.Activity.active?.();
      const playdata = Lampa.Player.playdata?.();
      const movie = activity?.movie;

      if (activity && playdata && movie) return { activity, playdata, movie };
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }

  function buildImportedLabel(osItem) {
    const langHuman = prettyLang(osItem.lang);
    const nlang = normLang(osItem.lang);
    const enc = osItem.SubEncoding ? String(osItem.SubEncoding).toUpperCase() : "";

    // Пример: "★ OS · Русский · CP1251 · #22030"
    const parts = [IMPORT_PREFIX, langHuman];
    if (enc) parts.push(enc);
    if (osItem.id) parts.push("#" + osItem.id);

    // если язык не ru/en — покажем код (чтобы было понятно)
    if (nlang && nlang !== "ru" && nlang !== "en" && nlang.length <= 3) {
      parts.push("(" + nlang.toUpperCase() + ")");
    }

    return parts.join(" · ");
  }

  async function setupSubs() {
    const pack = await waitForReady();
    if (!pack) return;

    const { playdata, movie } = pack;

    const imdb = movie.imdb_id || movie.imdb;
    if (!imdb || !/^tt\d+/.test(imdb)) {
      console.log("[os-sub] no imdb_id -> cannot use OpenSubtitles-v3 addon", {
        title: movie.title || movie.name,
        imdb,
      });
      return;
    }

    const isSeries = playdata.season != null && playdata.episode != null;
    const season = isSeries ? Number(playdata.season) : undefined;
    const episode = isSeries ? Number(playdata.episode) : undefined;

    // текущие сабы (что уже есть в плеере/источнике)
    const current = (playdata.subtitles || [])
      .map((s) => ({
        label: s.label || prettyLang(s.lang) || "Sub",
        url: s.url,
        lang: normLang(s.lang) || "",
        _imported: false,
      }))
      .filter((s) => s.url);

    // импортируемые сабы из OS v3
    const osSubsRaw = await fetchSubs(imdb, season, episode);

    const imported = (osSubsRaw || [])
      .map((s) => ({
        label: buildImportedLabel(s),
        url: s.url,
        lang: normLang(s.lang) || "",
        _imported: true,
      }))
      .filter((s) => s.url);

    // мерджим без дублей по URL
    const all = [...current];
    for (const s of imported) {
      if (!all.find((x) => x.url === s.url)) all.push(s);
    }

    if (!all.length) {
      console.log("[os-sub] no subtitles found for", { imdb, season, episode });
      return;
    }

    // выбираем дефолт: язык интерфейса (ru/en), предпочтение НЕимпортированным, если есть
    const pref = getPreferredLang();
    let idx = 0;

    if (pref) {
      const nonImportedIdx = all.findIndex((s) => s.lang === pref && !s._imported);
      const importedIdx = all.findIndex((s) => s.lang === pref && s._imported);

      if (nonImportedIdx !== -1) idx = nonImportedIdx;
      else if (importedIdx !== -1) idx = importedIdx;
      else idx = 0;
    } else {
      // если интерфейс не ru/en — оставим как есть (0)
      idx = 0;
    }

    console.log("[os-sub] push subtitles:", all);
    Lampa.Player.subtitles(all, idx);
  }

  // запуск на старте плеера
  Lampa.Player.listener.follow("start", () => setTimeout(setupSubs, 900));
})();
