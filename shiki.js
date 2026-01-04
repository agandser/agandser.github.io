(function () {
  'use strict';

  // ==========================================================
  // Shikimori Fan Hub (TMDB ONLY via Lampa.TMDB.api proxy)
  // Требование: TMDB proxy (Lampac/прокси) включён в системе.
  // Если TMDB идёт напрямую на api.themoviedb.org -> ошибка и выход.
  // ==========================================================

  if (window.plugin_shikifan_hub_proxy_ready) return;
  window.plugin_shikifan_hub_proxy_ready = true;

  var PLUGIN_NAME = 'Shikimori Fan Hub (Proxy TMDB)';
  var COMPONENT_HUB = 'ShikiFanHubProxy';
  var COMPONENT_ANIME = 'ShikiAnimeProxy';

  var SHIKI_ORIGIN = 'https://shikimori.one';
  var SHIKI_API_V1 = SHIKI_ORIGIN + '/api';
  var SHIKI_API_V2 = SHIKI_ORIGIN + '/api/v2';

  // Опционально для повышения точности: MAL -> IMDb -> TMDB /find
  var ARM_IDS = 'https://arm.haglund.dev/api/v2/ids';

  // Storage keys
  var SKEY_TOKEN = 'shikifan.token';
  var SKEY_CENSORED = 'shikifan.censored';

  // -------------------------
  // Helpers
  // -------------------------
  function sget(key, def) {
    try {
      var v = Lampa.Storage.get(key);
      return (v === undefined || v === null || v === '') ? def : v;
    } catch (e) {
      return def;
    }
  }

  function sset(key, val) {
    try { Lampa.Storage.set(key, val); } catch (e) {}
  }

  function bget(key, def) {
    var v = sget(key, def ? 'true' : 'false');
    return v === true || v === 'true' || v === 1 || v === '1';
  }

  function notify(txt) {
    try { Lampa.Noty.show(txt); }
    catch (e) { console.log('[Noty]', txt); }
  }

  function safeLang() {
    try { return Lampa.Storage.field('language') || 'ru'; }
    catch (e) { return 'ru'; }
  }

  function cleanText(html) {
    if (!html) return '';
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function titleByLang(anime) {
    var lang = safeLang();
    if (lang === 'ru') return (anime.russian || anime.name || anime.english || anime.japanese || '');
    return (anime.name || anime.english || anime.japanese || anime.russian || '');
  }

  function imgUrlFromV1(anime) {
    if (anime && anime.image) {
      if (anime.image.original) return SHIKI_ORIGIN + anime.image.original;
      if (anime.image.preview) return SHIKI_ORIGIN + anime.image.preview;
    }
    return '';
  }

  function buildQuery(params) {
    var q = [];
    for (var k in params) {
      if (!params.hasOwnProperty(k)) continue;
      var v = params[k];
      if (v === undefined || v === null || v === '') continue;
      q.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    }
    return q.length ? ('?' + q.join('&')) : '';
  }

  function buildUrl(base, path, params) {
    return base + path + (params ? buildQuery(params) : '');
  }

  function askText(title, value) {
    return new Promise(function (resolve) {
      if (Lampa.Input && Lampa.Input.show) {
        Lampa.Input.show({
          title: title,
          value: value || '',
          free: true,
          confirm: function (v) { resolve(v); },
          cancel: function () { resolve(null); }
        });
        return;
      }
      var v2 = prompt(title, value || '');
      resolve(v2 === null ? null : v2);
    });
  }

  // -------------------------
  // Rate limiter (мягко, чтобы не душить Shikimori)
  // -------------------------
  function RateLimiter(minGapMs) {
    this.minGapMs = minGapMs || 700;
    this.queue = [];
    this.busy = false;
    this.lastAt = 0;
  }

  RateLimiter.prototype.push = function (fn) {
    var self = this;
    return new Promise(function (resolve, reject) {
      self.queue.push({ fn: fn, resolve: resolve, reject: reject });
      self._pump();
    });
  };

  RateLimiter.prototype._pump = function () {
    var self = this;
    if (self.busy) return;
    if (!self.queue.length) return;

    var now = Date.now();
    var wait = Math.max(0, self.minGapMs - (now - self.lastAt));

    self.busy = true;
    setTimeout(function () {
      var job = self.queue.shift();
      self.lastAt = Date.now();
      Promise.resolve()
        .then(job.fn)
        .then(function (res) { self.busy = false; job.resolve(res); self._pump(); })
        .catch(function (err) { self.busy = false; job.reject(err); self._pump(); });
    }, wait);
  };

  var limiter = new RateLimiter(700);

  // -------------------------
  // Cache (Storage) - TTL
  // -------------------------
  function cacheKey(url) { return 'shikifan.cache.' + (Lampa.Utils ? Lampa.Utils.hash(url) : url); }

  function cacheGet(url) {
    var key = cacheKey(url);
    try {
      var raw = Lampa.Storage.get(key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.exp || Date.now() > obj.exp) return null;
      return obj.data;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(url, data, ttlMs) {
    var key = cacheKey(url);
    try {
      Lampa.Storage.set(key, JSON.stringify({
        exp: Date.now() + (ttlMs || 5 * 60 * 1000),
        data: data
      }));
    } catch (e) {}
  }

  // -------------------------
  // AJAX JSON
  // -------------------------
  function ajaxJSON(opt) {
    return new Promise(function (resolve, reject) {
      $.ajax({
        url: opt.url,
        method: opt.method || 'GET',
        timeout: opt.timeout || 20000,
        dataType: 'json',
        contentType: opt.contentType,
        data: opt.data,
        headers: opt.headers || {},
        success: function (data) { resolve(data); },
        error: function (jq, status, err) {
          reject({ status: jq.status, text: jq.responseText, err: err });
        }
      });
    });
  }

  // ==========================================================
  // TMDB via Lampa.TMDB.api ONLY (Proxy required)
  // ==========================================================
  function tmdbApiUrl(pathWithQuery) {
    if (!Lampa.TMDB || typeof Lampa.TMDB.api !== 'function') return '';
    return Lampa.TMDB.api(pathWithQuery);
  }

  function isTmdbProxyActive() {
    try {
      var u = tmdbApiUrl('configuration');
      if (!u) return false;
      // Если это прямой TMDB — запрещаем
      return u.indexOf('api.themoviedb.org/3/') === -1;
    } catch (e) {
      return false;
    }
  }

  var __tmdb_proxy_ok = false;

  function ensureTmdbProxyReady() {
    if (__tmdb_proxy_ok) return Promise.resolve(true);

    if (!Lampa.TMDB || typeof Lampa.TMDB.api !== 'function') {
      notify('TMDB: не найден Lampa.TMDB.api(). Нужен Lampac/прокси TMDB.');
      return Promise.reject('NO_LAMPA_TMDB_API');
    }

    if (!isTmdbProxyActive()) {
      notify('TMDB: прокси не активен. Включи proxy_tmdb / Lampac TMDB proxy (иначе плагин не работает).');
      return Promise.reject('PROXY_DISABLED');
    }

    // preflight
    var test = tmdbApiUrl('configuration' + buildQuery({ language: safeLang() }));
    return ajaxJSON({ url: test, method: 'GET' })
      .then(function () {
        __tmdb_proxy_ok = true;
        return true;
      })
      .catch(function (e) {
        var code = e && e.status ? e.status : 0;
        if (code === 401) notify('TMDB proxy: 401 (на прокси/лампак не настроен tmdb api key).');
        else if (code === 404) notify('TMDB proxy: 404 (не найден роут /tmdb/api/3 или аналог).');
        else notify('TMDB proxy: ошибка соединения.');
        return Promise.reject('PROXY_PRECHECK_FAIL');
      });
  }

  function tmdbGet(path, params) {
    return ensureTmdbProxyReady().then(function () {
      var url = tmdbApiUrl(path + buildQuery(params || {}));
      return ajaxJSON({ url: url, method: 'GET' });
    });
  }

  // ==========================================================
  // Shikimori API wrappers
  // ==========================================================
  function shikiGetV1(path, params, ttlMs) {
    var url = buildUrl(SHIKI_API_V1, path, params);
    var cached = cacheGet(url);
    if (cached) return Promise.resolve(cached);

    return limiter.push(function () {
      return ajaxJSON({ url: url, method: 'GET' }).then(function (data) {
        cacheSet(url, data, ttlMs || 5 * 60 * 1000);
        return data;
      });
    });
  }

  function shikiGetV2(path, params, auth) {
    var url = buildUrl(SHIKI_API_V2, path, params);
    return limiter.push(function () {
      return ajaxJSON({
        url: url,
        method: 'GET',
        headers: auth ? { 'Authorization': 'Bearer ' + auth } : {}
      });
    });
  }

  function shikiPostV2(path, body, auth) {
    var url = buildUrl(SHIKI_API_V2, path, null);
    return limiter.push(function () {
      return ajaxJSON({
        url: url,
        method: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(body),
        headers: auth ? { 'Authorization': 'Bearer ' + auth } : {}
      });
    });
  }

  function shikiPatchV2(path, body, auth) {
    var url = buildUrl(SHIKI_API_V2, path, null);
    return limiter.push(function () {
      return ajaxJSON({
        url: url,
        method: 'PATCH',
        contentType: 'application/json',
        data: JSON.stringify(body),
        headers: auth ? { 'Authorization': 'Bearer ' + auth } : {}
      });
    });
  }

  function shikiWhoami(auth) {
    return limiter.push(function () {
      return ajaxJSON({
        url: SHIKI_API_V1 + '/users/whoami',
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + auth }
      });
    });
  }

  // ==========================================================
  // My lists (user_rates)
  // ==========================================================
  function ensureAuth() {
    var token = String(sget(SKEY_TOKEN, '') || '').trim();
    if (!token) return Promise.reject('TOKEN_MISSING');
    return shikiWhoami(token).then(function (me) {
      return { token: token, me: me };
    });
  }

  function listUserRates(userId, status, token) {
    return shikiGetV2('/user_rates', {
      user_id: userId,
      target_type: 'Anime',
      status: status
    }, token);
  }

  function getUserRateForAnime(userId, animeId, token) {
    return shikiGetV2('/user_rates', {
      user_id: userId,
      target_type: 'Anime',
      target_id: animeId
    }, token).then(function (arr) {
      if (arr && arr.length) return arr[0];
      return null;
    });
  }

  function upsertUserRate(userId, animeId, patch, token) {
    return getUserRateForAnime(userId, animeId, token).then(function (ur) {
      if (ur && ur.id) {
        return shikiPatchV2('/user_rates/' + ur.id, { user_rate: patch }, token);
      }

      var body = {
        user_rate: {
          user_id: userId,
          target_id: animeId,
          target_type: 'Anime'
        }
      };
      for (var k in patch) body.user_rate[k] = patch[k];
      return shikiPostV2('/user_rates', body, token);
    });
  }

  // ==========================================================
  // TMDB open in Lampa
  // ==========================================================
  function pickTmdbFromFind(findRes, kind) {
    if (!findRes) return null;
    var tv = findRes.tv_results || [];
    var mv = findRes.movie_results || [];
    if (kind === 'movie' && mv.length) return { id: mv[0].id, method: 'movie', card: mv[0] };
    if (kind !== 'movie' && tv.length) return { id: tv[0].id, method: 'tv', card: tv[0] };
    if (tv.length) return { id: tv[0].id, method: 'tv', card: tv[0] };
    if (mv.length) return { id: mv[0].id, method: 'movie', card: mv[0] };
    return null;
  }

  function armIdsByMal(malId) {
    var url = buildUrl(ARM_IDS, '', { source: 'myanimelist', id: malId });
    return ajaxJSON({ url: url, method: 'GET' });
  }

  function openInLampaByAnime(animeId) {
    return ensureTmdbProxyReady().then(function () {
      return shikiGetV1('/animes/' + animeId, null, 10 * 60 * 1000);
    }).then(function (anime) {
      var kind = anime.kind || 'tv';
      var title = anime.name || anime.russian || anime.english || '';
      var year = (anime.aired_on && String(anime.aired_on).slice(0, 4)) || '';
      var mal = anime.myanimelist_id || null;

      // 1) MAL -> IMDb -> TMDB find
      if (mal) {
        return armIdsByMal(mal).then(function (ids) {
          if (ids && ids.imdb) {
            return tmdbGet('find/' + ids.imdb, {
              external_source: 'imdb_id',
              language: safeLang()
            }).then(function (findRes) {
              var picked = pickTmdbFromFind(findRes, kind);
              if (picked) return picked;
              throw new Error('TMDB_FIND_EMPTY');
            });
          }
          throw new Error('NO_IMDB');
        }).catch(function () {
          // 2) fallback: search
          var path = (kind === 'movie') ? 'search/movie' : 'search/tv';
          var p = { query: title, language: safeLang() };
          if (kind === 'movie' && year) p.year = year;
          if (kind !== 'movie' && year) p.first_air_date_year = year;

          return tmdbGet(path, p).then(function (sr) {
            if (!sr || !sr.results || !sr.results.length) throw new Error('TMDB_SEARCH_EMPTY');
            return {
              id: sr.results[0].id,
              method: (kind === 'movie') ? 'movie' : 'tv',
              card: sr.results[0]
            };
          });
        });
      }

      // MAL нет -> search
      var path2 = (kind === 'movie') ? 'search/movie' : 'search/tv';
      return tmdbGet(path2, { query: title, language: safeLang() }).then(function (sr2) {
        if (!sr2 || !sr2.results || !sr2.results.length) throw new Error('TMDB_SEARCH_EMPTY');
        return {
          id: sr2.results[0].id,
          method: (kind === 'movie') ? 'movie' : 'tv',
          card: sr2.results[0]
        };
      });
    }).then(function (picked) {
      Lampa.Activity.push({
        url: '',
        component: 'full',
        id: picked.id,
        method: picked.method,
        card: picked.card
      });
    }).catch(function (e) {
      if (e && e.message) notify(e.message);
    });
  }

  // ==========================================================
  // Settings
  // ==========================================================
  function clearCache() {
    try {
      var all = Lampa.Storage.all();
      for (var k in all) {
        if (k.indexOf('shikifan.cache.') === 0) Lampa.Storage.set(k, '');
      }
    } catch (e) {}
  }

  function openSettings() {
    var token = String(sget(SKEY_TOKEN, '') || '').trim();
    var censored = bget(SKEY_CENSORED, true);

    var proxyUrl = tmdbApiUrl('configuration') || '(нет Lampa.TMDB.api)';
    var proxyMode = isTmdbProxyActive() ? 'proxy' : 'direct';

    Lampa.Select.show({
      title: PLUGIN_NAME + ' — Settings',
      items: [
        { title: 'Shikimori token (Bearer)', subtitle: token ? 'задан' : 'не задан', key: 'token' },
        { title: 'Censored', subtitle: censored ? 'true' : 'false', key: 'censored' },
        { title: 'TMDB mode', subtitle: proxyMode + ' • ' + proxyUrl, key: 'check' },
        { title: 'Очистить кэш', subtitle: 'локальный кэш запросов', key: 'clear' }
      ],
      onBack: function () { Lampa.Controller.toggle('content'); },
      onSelect: function (a) {
        if (a.key === 'token') {
          askText('Вставь Shikimori OAuth token (Bearer)', token).then(function (v) {
            if (v === null) return;
            sset(SKEY_TOKEN, String(v).trim());
            notify('Token сохранён');
          });
        }

        if (a.key === 'censored') {
          sset(SKEY_CENSORED, censored ? 'false' : 'true');
          notify('Censored: ' + (censored ? 'false' : 'true'));
        }

        if (a.key === 'check') {
          ensureTmdbProxyReady()
            .then(function () { notify('TMDB proxy: OK'); })
            .catch(function () {});
        }

        if (a.key === 'clear') {
          clearCache();
          notify('Кэш очищен');
        }
      }
    });
  }

  // ==========================================================
  // Templates + styles
  // ==========================================================
  Lampa.Template.add('ShikiFanHubProxyStyle',
    "<style>" +
      ".shikifan-head{margin-left:1.5em}" +
      ".shikifan-list.category-full{justify-content:space-between!important}" +
      ".shikifan-card .card__type{background:#ff4242;color:#fff}" +
      ".shikifan-badge{position:absolute;left:-.8em;top:3.4em;padding:.4em;background:#05f;color:#fff;font-size:.8em;border-radius:.3em}" +
      ".shikifan-badge2{position:absolute;left:-.8em;bottom:1em;padding:.4em;background:#ffe216;color:#000;font-size:.8em;border-radius:.3em}" +
      ".shikianime{padding:1em 1.5em}" +
      ".shikianime__top{display:flex;gap:1em}" +
      ".shikianime__poster{width:10em;flex:0 0 auto;border-radius:.6em;overflow:hidden}" +
      ".shikianime__poster img{width:100%;display:block}" +
      ".shikianime__meta{flex:1 1 auto}" +
      ".shikianime__title{font-size:1.35em;font-weight:700;margin-bottom:.35em}" +
      ".shikianime__sub{opacity:.8;margin-bottom:.7em}" +
      ".shikianime__info{display:grid;grid-template-columns:1fr 1fr;gap:.35em .8em;margin-bottom:.8em}" +
      ".shikianime__descr{white-space:pre-wrap;opacity:.9;line-height:1.35}" +
      ".shikianime__chips{display:flex;flex-wrap:wrap;gap:.35em;margin:.6em 0}" +
      ".shikianime__chip{padding:.25em .5em;border-radius:999px;background:rgba(255,255,255,.08)}" +
      ".shikifan-actions{display:flex;gap:.5em;margin:.8em 0}" +
      ".shikifan-actions .simple-button{padding:.55em .8em}" +
    "</style>"
  );

  Lampa.Template.add('ShikiFanHubProxyCard',
    "<div class='shikifan-card card selector layer--visible layer--render'>" +
      "<div class='card__view'>" +
        "<img src='{img}' class='card__img' />" +
        "<div class='card__type'>{type}</div>" +
        "<div class='card__vote'>{rate}</div>" +
        "<div class='shikifan-badge'>{badge}</div>" +
        "<div class='shikifan-badge2'>{badge2}</div>" +
      "</div>" +
      "<div class='card__title'>{title}</div>" +
    "</div>"
  );

  Lampa.Template.add('ShikiAnimeProxyTpl',
    "<div class='shikianime'>" +
      "<div class='shikianime__top'>" +
        "<div class='shikianime__poster'><img src='{img}' /></div>" +
        "<div class='shikianime__meta'>" +
          "<div class='shikianime__title'>{title}</div>" +
          "<div class='shikianime__sub'>{sub}</div>" +
          "<div class='shikianime__info'>" +
            "<div>Тип: <b>{kind}</b></div>" +
            "<div>Статус: <b>{status}</b></div>" +
            "<div>Эпизоды: <b>{eps}</b></div>" +
            "<div>Score: <b>{score}</b></div>" +
          "</div>" +
          "<div class='shikianime__chips'>{chips}</div>" +
          "<div class='shikifan-actions'>" +
            "<div class='shikifan-watch simple-button selector'>Смотреть (Lampa)</div>" +
            "<div class='shikifan-rate simple-button selector'>В список</div>" +
            "<div class='shikifan-site simple-button selector'>Shikimori</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
      "<div class='shikianime__descr'>{descr}</div>" +
      "<div style='margin-top:1em;opacity:.85'>{fan}</div>" +
    "</div>"
  );

  $('body').append(Lampa.Template.get('ShikiFanHubProxyStyle', {}, true));

  // ==========================================================
  // Card
  // ==========================================================
  function ShikiCard(anime) {
    var badge = anime.aired_on ? String(anime.aired_on).slice(0, 4) : ' ';
    var badge2 = anime.status || ' ';
    var item = Lampa.Template.get('ShikiFanHubProxyCard', {
      img: imgUrlFromV1(anime),
      type: (anime.kind || '').toUpperCase(),
      rate: (anime.score != null) ? anime.score : '0',
      title: titleByLang(anime),
      badge: badge,
      badge2: badge2
    });

    this.render = function () { return item; };
    this.destroy = function () { try { item.remove(); } catch (e) {} };
  }

  // ==========================================================
  // HUB component
  // ==========================================================
  function ShikiFanHub(object) {
    var self = this;

    var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
    var html = $("<div class='shikifan'></div>");

    var head = $("<div class='shikifan-head torrent-filter'>" +
      "<div class='shiki_home simple-button simple-button--filter selector'>Home</div>" +
      "<div class='shiki_search simple-button simple-button--filter selector'>Search</div>" +
      "<div class='shiki_calendar simple-button simple-button--filter selector'>Calendar</div>" +
      "<div class='shiki_my simple-button simple-button--filter selector'>My</div>" +
      "<div class='shiki_settings simple-button simple-button--filter selector'>Settings</div>" +
    "</div>");

    var body = $("<div class='shikifan-list category-full'></div>");

    var items = [];
    var lastFocus = null;

    var state = {
      page: object.page || 1,
      mode: object.mode || 'home',
      query: object.query || '',
      my_status: object.my_status || ''
    };

    function clearList() {
      try { Lampa.Arrays.destroy(items); } catch (e) {}
      items = [];
      body.empty();
      scroll.minus();
    }

    function appendAnimes(list) {
      (list || []).forEach(function (anime) {
        var card = new ShikiCard(anime);
        card.render()
          .on('hover:focus', function () {
            lastFocus = card.render()[0];
            scroll.update(card.render(), true);
          })
          .on('hover:enter', function () {
            Lampa.Activity.push({ url: '', title: titleByLang(anime), component: COMPONENT_ANIME, anime_id: anime.id });
          });

        body.append(card.render());
        items.push(card);
      });
    }

    function loadHome() {
      var params = {
        page: state.page,
        limit: 36,
        order: 'popularity',
        censored: bget(SKEY_CENSORED, true) ? 'true' : 'false'
      };

      shikiGetV1('/animes', params, 2 * 60 * 1000)
        .then(function (list) { appendAnimes(list); self.activity.loader(false); self.activity.toggle(); })
        .catch(function () { self.empty(); });
    }

    function loadSearch() {
      var params = {
        page: state.page,
        limit: 36,
        order: 'popularity',
        search: state.query,
        censored: bget(SKEY_CENSORED, true) ? 'true' : 'false'
      };

      shikiGetV1('/animes', params, 60 * 1000)
        .then(function (list) { appendAnimes(list); self.activity.loader(false); self.activity.toggle(); })
        .catch(function () { self.empty(); });
    }

    function loadCalendar() {
      var url = buildUrl(SHIKI_API_V1, '/calendar', { censored: bget(SKEY_CENSORED, true) ? 'true' : 'false' });
      var cached = cacheGet(url);

      var p = cached ? Promise.resolve(cached) : limiter.push(function () {
        return ajaxJSON({ url: url, method: 'GET' }).then(function (data) {
          cacheSet(url, data, 5 * 60 * 1000);
          return data;
        });
      });

      p.then(function (days) {
        var flat = [];
        (days || []).forEach(function (row) {
          if (row && row.anime) flat.push(row.anime);
        });
        appendAnimes(flat);
        self.activity.loader(false);
        self.activity.toggle();
      }).catch(function () { self.empty(); });
    }

    function loadMy(status) {
      ensureAuth().then(function (auth) {
        return listUserRates(auth.me.id, status, auth.token).then(function (rates) {
          var ids = [];
          (rates || []).forEach(function (r) { if (r && r.target_id) ids.push(r.target_id); });

          if (!ids.length) return [];

          return shikiGetV1('/animes', {
            ids: ids.join(','),
            limit: 50,
            order: 'popularity',
            censored: bget(SKEY_CENSORED, true) ? 'true' : 'false'
          }, 2 * 60 * 1000);
        });
      }).then(function (list) {
        appendAnimes(list || []);
        self.activity.loader(false);
        self.activity.toggle();
      }).catch(function () {
        notify('Нужен token (Settings → Shikimori token)');
        self.empty();
      });
    }

    function openMyMenu() {
      ensureAuth().then(function () {
        Lampa.Select.show({
          title: 'My lists',
          items: [
            { title: 'watching', code: 'watching' },
            { title: 'planned', code: 'planned' },
            { title: 'completed', code: 'completed' },
            { title: 'on_hold', code: 'on_hold' },
            { title: 'dropped', code: 'dropped' },
            { title: 'rewatching', code: 'rewatching' }
          ],
          onBack: function () { Lampa.Controller.toggle('content'); },
          onSelect: function (a) {
            Lampa.Activity.push({ url: '', title: 'Shikimori — ' + a.code, component: COMPONENT_HUB, page: 1, mode: 'my', my_status: a.code });
          }
        });
      }).catch(function () {
        notify('Нужен token (Settings → Shikimori token)');
      });
    }

    function attachHead() {
      head.find('.shiki_home').off('hover:enter').on('hover:enter', function () {
        Lampa.Activity.push({ url: '', title: 'Shikimori', component: COMPONENT_HUB, page: 1, mode: 'home' });
      });

      head.find('.shiki_search').off('hover:enter').on('hover:enter', function () {
        askText('Поиск по Shikimori', state.query).then(function (q) {
          if (!q) return;
          Lampa.Activity.push({ url: '', title: 'Shikimori', component: COMPONENT_HUB, page: 1, mode: 'search', query: q });
        });
      });

      head.find('.shiki_calendar').off('hover:enter').on('hover:enter', function () {
        Lampa.Activity.push({ url: '', title: 'Shikimori', component: COMPONENT_HUB, page: 1, mode: 'calendar' });
      });

      head.find('.shiki_my').off('hover:enter').on('hover:enter', function () {
        openMyMenu();
      });

      head.find('.shiki_settings').off('hover:enter').on('hover:enter', function () {
        openSettings();
      });
    }

    function setupPaging(loaderFn) {
      scroll.onEnd = function () {
        state.page += 1;
        loaderFn();
      };
    }

    this.create = function () {
      // Жёсткое требование: если нет TMDB proxy — дальше не работаем вообще
      ensureTmdbProxyReady().then(function () {
        attachHead();
        clearList();

        scroll.onWheel = function (step) {
          if (!Lampa.Controller.own(self)) self.start();
          if (step > 0) Navigator.move('down'); else Navigator.move('up');
        };

        scroll.append(head);
        scroll.append(body);
        html.append(scroll.render(true));

        self.activity.loader(true);

        if (state.mode === 'home') { setupPaging(loadHome); loadHome(); }
        else if (state.mode === 'search') { setupPaging(loadSearch); loadSearch(); }
        else if (state.mode === 'calendar') { scroll.onEnd = function () {}; loadCalendar(); }
        else if (state.mode === 'my') { scroll.onEnd = function () {}; loadMy(state.my_status || 'watching'); }
        else { setupPaging(loadHome); loadHome(); }

        self.start();
      }).catch(function () {
        self.empty();
      });
    };

    this.empty = function () {
      var empty = new Lampa.Empty();
      html.append(empty.render(true));
      this.start = empty.start;
      self.activity.loader(false);
      self.activity.toggle();
    };

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return;

      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render());
          Lampa.Controller.collectionFocus(lastFocus || false, scroll.render());
        },
        left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
        right: function () { Navigator.move('right'); },
        up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
        down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
        back: function () { Lampa.Activity.backward(); }
      });

      Lampa.Controller.toggle('content');
    };

    this.pause = function () {};
    this.stop = function () {};
    this.render = function (js) { return js ? html : $(html); };
    this.destroy = function () {
      try { Lampa.Arrays.destroy(items); } catch (e) {}
      try { scroll.destroy(); } catch (e2) {}
      try { html.remove(); } catch (e3) {}
      items = null;
    };
  }

  // ==========================================================
  // ANIME component (detail + actions)
  // ==========================================================
  function ShikiAnime(object) {
    var self = this;

    var html = $("<div></div>");
    var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });

    function openRateMenu(anime) {
      ensureAuth().then(function (auth) {
        Lampa.Select.show({
          title: 'Статус / прогресс',
          items: [
            { title: 'Статус: watching', key: 'watching' },
            { title: 'Статус: planned', key: 'planned' },
            { title: 'Статус: completed', key: 'completed' },
            { title: 'Статус: on_hold', key: 'on_hold' },
            { title: 'Статус: dropped', key: 'dropped' },
            { title: 'Эпизоды…', key: 'episodes' },
            { title: 'Оценка (0..10)…', key: 'score' }
          ],
          onBack: function () { Lampa.Controller.toggle('content'); },
          onSelect: function (a) {
            if (a.key === 'episodes') {
              askText('Сколько эпизодов просмотрено?', String(anime.episodes_aired || 0)).then(function (v) {
                if (v === null) return;
                var n = parseInt(v, 10);
                if (isNaN(n) || n < 0) return notify('Неверное число');
                upsertUserRate(auth.me.id, anime.id, { episodes: n, status: 'watching' }, auth.token)
                  .then(function () { notify('Эпизоды обновлены'); })
                  .catch(function () { notify('Не удалось обновить эпизоды'); });
              });
              return;
            }

            if (a.key === 'score') {
              askText('Оценка (0..10)', '0').then(function (v2) {
                if (v2 === null) return;
                var sc = parseInt(v2, 10);
                if (isNaN(sc) || sc < 0 || sc > 10) return notify('Оценка 0..10');
                upsertUserRate(auth.me.id, anime.id, { score: sc }, auth.token)
                  .then(function () { notify('Оценка обновлена'); })
                  .catch(function () { notify('Не удалось обновить оценку'); });
              });
              return;
            }

            upsertUserRate(auth.me.id, anime.id, { status: a.key }, auth.token)
              .then(function () { notify('Статус обновлён'); })
              .catch(function () { notify('Не удалось обновить статус'); });
          }
        });
      }).catch(function () {
        notify('Нужен token (Settings → Shikimori token)');
      });
    }

    function build(anime) {
      var chips = [];
      if (anime.genres && anime.genres.length) {
        anime.genres.slice(0, 12).forEach(function (g) {
          chips.push("<span class='shikianime__chip'>" + (g.russian || g.name) + "</span>");
        });
      }

      var fan = [];
      if (anime.fansubbers && anime.fansubbers.length) fan.push("Fansub: <b>" + anime.fansubbers.join(', ') + "</b>");
      if (anime.fandubbers && anime.fandubbers.length) fan.push("Fandub: <b>" + anime.fandubbers.join(', ') + "</b>");
      if (anime.next_episode_at) fan.push("Next: <b>" + anime.next_episode_at + "</b>");

      var node = $(Lampa.Template.get('ShikiAnimeProxyTpl', {
        img: imgUrlFromV1(anime),
        title: titleByLang(anime),
        sub: (anime.name || '') + (anime.aired_on ? (' • ' + anime.aired_on) : ''),
        kind: (anime.kind || '').toUpperCase(),
        status: anime.status || '',
        eps: (anime.episodes_aired || 0) + '/' + (anime.episodes || '?'),
        score: anime.score || '0',
        chips: chips.join(''),
        descr: cleanText(anime.description_html || anime.description || ''),
        fan: fan.join('<br/>')
      }, true));

      node.find('.shikifan-watch').on('hover:enter', function () {
        openInLampaByAnime(anime.id);
      });

      node.find('.shikifan-rate').on('hover:enter', function () {
        openRateMenu(anime);
      });

      node.find('.shikifan-site').on('hover:enter', function () {
        try { window.open(SHIKI_ORIGIN + anime.url, '_blank'); }
        catch (e) { notify('URL: ' + (SHIKI_ORIGIN + anime.url)); }
      });

      scroll.append(node);
      html.append(scroll.render(true));

      self.activity.loader(false);
      self.activity.toggle();
      self.start();
    }

    this.create = function () {
      self.activity.loader(true);

      var animeId = object.anime_id;
      if (!animeId) return self.empty();

      // TMDB proxy требуем глобально; но для страницы аниме тоже проверим
      ensureTmdbProxyReady().then(function () {
        return shikiGetV1('/animes/' + animeId, null, 10 * 60 * 1000);
      }).then(build).catch(function () { self.empty(); });
    };

    this.empty = function () {
      var empty = new Lampa.Empty();
      html.append(empty.render(true));
      this.start = empty.start;
      self.activity.loader(false);
      self.activity.toggle();
    };

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return;

      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render());
          Lampa.Controller.collectionFocus(false, scroll.render());
        },
        left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
        right: function () { Navigator.move('right'); },
        up: function () { if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
        down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
        back: function () { Lampa.Activity.backward(); }
      });

      Lampa.Controller.toggle('content');
    };

    this.pause = function () {};
    this.stop = function () {};
    this.render = function (js) { return js ? html : $(html); };
    this.destroy = function () {
      try { scroll.destroy(); } catch (e) {}
      try { html.remove(); } catch (e2) {}
    };
  }

  // ==========================================================
  // Menu + start
  // ==========================================================
  function addMenuButton() {
    var btn = $(
      "<li class='menu__item selector'>" +
        "<div class='menu__ico'>" +
          "<svg fill='currentColor' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'>" +
            "<path d='M12 2l9 4v6c0 5-3.8 9.7-9 10-5.2-.3-9-5-9-10V6l9-4z'/>" +
          "</svg>" +
        "</div>" +
        "<div class='menu__text'>Shikimori</div>" +
      "</li>"
    );

    btn.on('hover:enter', function () {
      ensureTmdbProxyReady().then(function () {
        Lampa.Activity.push({ url: '', title: 'Shikimori', component: COMPONENT_HUB, page: 1, mode: 'home' });
      }).catch(function () {});
    });

    $('.menu .menu__list').eq(0).append(btn);
  }

  function startPlugin() {
    Lampa.Component.add(COMPONENT_HUB, ShikiFanHub);
    Lampa.Component.add(COMPONENT_ANIME, ShikiAnime);

    if (window.appready) addMenuButton();
    else {
      Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') addMenuButton();
      });
    }
  }

  startPlugin();

})();
