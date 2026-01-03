(function () {
  const OSV3 = "https://opensubtitles-v3.strem.io/";
  const cache = {};

  function normLang(lang) {
    if (!lang) return "";
    lang = String(lang).toLowerCase();
    if (lang === "eng" || lang === "en") return "en";
    if (lang === "rus" || lang === "ru") return "ru";
    return "";
  }

  async function fetchSubs(imdb, season, episode) {
    const key = `${imdb}_${season || 0}_${episode || 0}`;
    if (cache[key]) return cache[key];

    const isSeries = season != null && episode != null;
    const url = isSeries
      ? `${OSV3}subtitles/series/${imdb}:${season}:${episode}.json`
      : `${OSV3}subtitles/movie/${imdb}.json`;

    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      return (cache[key] = (j && j.subtitles) ? j.subtitles : []);
    } catch (e) {
      console.log("[sub.js] fetch failed", e);
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

  async function setupSubs() {
    const pack = await waitForReady();
    if (!pack) return;

    const { activity, playdata, movie } = pack;

    const imdb = movie.imdb_id || movie.imdb;
    if (!imdb || !/^tt\d+/.test(imdb)) {
      console.log("[sub.js] no imdb_id -> cannot use OpenSubtitles-v3 addon", {
        title: movie.title || movie.name,
        imdb: imdb
      });
      return;
    }

    const isSeries = !!playdata.season && !!playdata.episode;
    const season = isSeries ? Number(playdata.season) : undefined;
    const episode = isSeries ? Number(playdata.episode) : undefined;

    const osSubs = await fetchSubs(imdb, season, episode);

    const fromOS = osSubs
      .map((s) => ({
        label: normLang(s.lang) || s.lang || "sub",
        url: s.url,
        lang: normLang(s.lang),
      }))
      .filter((s) => (s.lang === "en" || s.lang === "ru") && s.url);

    const current = (playdata.subtitles || [])
      .map((s) => ({
        label: s.label || s.lang || "sub",
        url: s.url,
        lang: normLang(s.lang),
      }))
      .filter((s) => s.url);

    const all = [...current];
    for (const s of fromOS) {
      if (!all.find((x) => x.url === s.url)) all.push(s);
    }

    if (!all.length) {
      console.log("[sub.js] no subtitles found for", { imdb, season, episode });
      return;
    }

    const idx = all.findIndex((s) => s.lang === "en");
    console.log("[sub.js] push subtitles", all);

    Lampa.Player.subtitles(all, idx === -1 ? 0 : idx);
  }

  Lampa.Player.listener.follow("start", () => setTimeout(setupSubs, 1000));
})();