(function () {
  "use strict";

  if (window.plugin_style_interface_cardify_final_v4) return;
  window.plugin_style_interface_cardify_final_v4 = true;

  var bootTimer = setInterval(function () {
    if (window.Lampa && window["app" + "re" + "ady"]) {
      clearInterval(bootTimer);
      try {
        init();
      } catch (e) {
        console.log("final v4 init error", e);
      }
    }
  }, 200);

  function init() {
    if (!window.Lampa) return;

    try { Lampa.Platform.tv(); } catch (e) {}

    if (!Lampa.Maker || !Lampa.Maker.map || !Lampa.Utils || !Lampa.Template) return;

    // Возвращаем то, что было в твоём стиль-плагине (ИМЕННО это чинит “полетел текст”)
    try {
      Lampa.Storage.set("interface_size", "small");
      Lampa.Storage.set("background", "false");
    } catch (e) {}

    // -----------------------------
    // Utils
    // -----------------------------
    function addOnceStyle(id, cssText) {
      try {
        if (document.getElementById(id)) return;
        var st = document.createElement("style");
        st.id = id;
        st.textContent = cssText;
        document.body.appendChild(st);
      } catch (e) {}
    }

    function ensureYT(cb) {
      if (window.YT && YT.Player) return cb();

      if (document.getElementById("final_yt_api")) {
        var t = setInterval(function () {
          if (window.YT && YT.Player) {
            clearInterval(t);
            cb();
          }
        }, 200);
        return;
      }

      var tag = document.createElement("script");
      tag.id = "final_yt_api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);

      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        try { if (typeof prev === "function") prev(); } catch (e) {}
        cb();
      };
    }

    function wrapMethod(object, methodName, wrapper) {
      if (!object) return;
      var originalMethod = typeof object[methodName] === "function" ? object[methodName] : null;
      object[methodName] = function () {
        var args = Array.prototype.slice.call(arguments);
        return wrapper.call(this, originalMethod, args);
      };
    }

    function shouldEnableInterface(object) {
      if (!object) return false;
      if (window.innerWidth < 767) return false;
      if (Lampa.Platform.screen("mobile")) return false;
      if (object.title === "Избранное") return false;
      return true;
    }

    // -----------------------------
    // Stop helpers (catalog audio)
    // -----------------------------
    if (!window.__final_catalog_trailers) window.__final_catalog_trailers = [];

    function stopAllCatalogTrailers(destroy) {
      try {
        window.__final_catalog_trailers = (window.__final_catalog_trailers || []).filter(Boolean);
        window.__final_catalog_trailers.forEach(function (t) {
          try { destroy ? t.destroy() : t.stop(); } catch (e) {}
        });
        if (destroy) window.__final_catalog_trailers = [];
      } catch (e) {}
    }

    function stopCatalogYoutubeIframes() {
      // страховка на случай, если где-то остался iframe
      try {
        var frames = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"]');
        frames.forEach(function (fr) {
          // не трогаем full(Cardify)
          if (fr.closest(".full-start-new, .cardify, .cardify-bgtrailer")) return;

          try {
            fr.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', "*");
            fr.contentWindow.postMessage('{"event":"command","func":"stopVideo","args":""}', "*");
            fr.contentWindow.postMessage('{"event":"command","func":"mute","args":""}', "*");
          } catch (e) {}
        });
      } catch (e2) {}
    }

    function stopCatalogEverything(destroy) {
      stopAllCatalogTrailers(!!destroy);
      stopCatalogYoutubeIframes();
    }

    function hasBlockingOverlay() {
      // если мы ушли из каталога (карточка/настройки/плеер/модалка) — каталог видео должен молчать
      try {
        if (document.querySelector(".full-start-new, .full-start")) return true;
        if (document.querySelector(".settings, .settings__body")) return true;
        if (document.querySelector(".player, .player-panel, .modal, .selectbox")) return true;
      } catch (e) {}
      return false;
    }

    // -----------------------------
    // TMDB fetch (videos) — более надёжно через /videos + fallback lang
    // -----------------------------
    var globalCache = {};
    var pending = {};

    function tmdbKey() {
      try { return Lampa.TMDB && Lampa.TMDB.key && Lampa.TMDB.key(); } catch (e) {}
      return "";
    }

    function tmdbApi(path) {
      try { return Lampa.TMDB.api(path); } catch (e) {}
      return "";
    }

    function getMediaType(data) {
      return data && (data.media_type === "tv" || data.name) ? "tv" : "movie";
    }

    function getLang() {
      try {
        return Lampa.Storage.field("tmdb_lang") || Lampa.Storage.get("language") || "ru";
      } catch (e) {}
      return "ru";
    }

    function fetchJson(url, cb) {
      if (!url) return cb(null);

      if (globalCache[url]) return cb(globalCache[url]);

      if (pending[url]) {
        pending[url].push(cb);
        return;
      }

      pending[url] = [cb];

      var req = new Lampa.Reguest();
      req.silent(
        url,
        function (resp) {
          globalCache[url] = resp;
          var arr = pending[url] || [];
          delete pending[url];
          arr.forEach(function (fn) { try { fn(resp); } catch (e) {} });
        },
        function () {
          var arr2 = pending[url] || [];
          delete pending[url];
          arr2.forEach(function (fn) { try { fn(null); } catch (e) {} });
        }
      );
    }

    function ensureVideos(data, cb) {
      if (!data || !data.id) return cb(null);

      var type = getMediaType(data);
      var key = tmdbKey();
      if (!key) return cb(null);

      var lang = getLang();

      var url1 = tmdbApi(type + "/" + data.id + "/videos?api_key=" + key + "&language=" + encodeURIComponent(lang));
      var url2 = tmdbApi(type + "/" + data.id + "/videos?api_key=" + key + "&language=en-US");

      fetchJson(url1, function (r1) {
        if (r1 && r1.results && r1.results.length) return cb(r1);
        fetchJson(url2, function (r2) {
          cb(r2 && r2.results ? r2 : r1);
        });
      });
    }

    function pickTrailer(videosResp) {
      if (!videosResp || !videosResp.results || !videosResp.results.length) return null;

      var items = videosResp.results
        .filter(function (v) { return v && v.key && (!v.site || (v.site + "").toLowerCase() === "youtube"); })
        .map(function (v) {
          return {
            id: v.key,
            code: v.iso_639_1,
            type: (v.type || "").toLowerCase(),
            time: v.published_at ? new Date(v.published_at).getTime() : 0
          };
        });

      if (!items.length) return null;

      // приоритет: Trailer > Teaser > другое, потом по дате
      items.sort(function (a, b) {
        var ap = a.type === "trailer" ? 2 : a.type === "teaser" ? 1 : 0;
        var bp = b.type === "trailer" ? 2 : b.type === "teaser" ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return (b.time || 0) - (a.time || 0);
      });

      var lang = getLang();
      var my = items.find(function (x) { return x.code === lang; });
      var en = items.find(function (x) { return x.code === "en"; });

      return my || en || items[0] || null;
    }

    // -----------------------------
    // 1) Cardify template + css (чтобы на странице фильма снова были минималистичные кнопки)
    // -----------------------------
    function installCardify() {
      // template как у твоего плагина
      Lampa.Template.add("full_start_new", `<div class="full-start-new cardify">
        <div class="full-start-new__body">
          <div class="full-start-new__left hide">
            <div class="full-start-new__poster">
              <img class="full-start-new__img full--poster" />
            </div>
          </div>

          <div class="full-start-new__right">
            <div class="cardify__left">
              <div class="full-start-new__head"></div>
              <div class="full-start-new__title">{title}</div>

              <div class="cardify__details">
                <div class="full-start-new__details"></div>
              </div>

              <div class="full-start-new__buttons">
                <div class="full-start__button selector button--play">
                  <svg width="28" height="29" viewBox="0 0 28 29" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="14" cy="14.5" r="13" stroke="currentColor" stroke-width="2.7"/>
                    <path d="M18.0739 13.634C18.7406 14.0189 18.7406 14.9811 18.0739 15.366L11.751 19.0166C11.0843 19.4015 10.251 18.9204 10.251 18.1506L10.251 10.8494C10.251 10.0796 11.0843 9.5985 11.751 9.9834L18.0739 13.634Z" fill="currentColor"/>
                  </svg>
                  <span>#{title_watch}</span>
                </div>

                <div class="full-start__button selector button--book">
                  <svg width="21" height="32" viewBox="0 0 21 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2 1.5H19C19.2761 1.5 19.5 1.72386 19.5 2V27.9618C19.5 28.3756 19.0261 28.6103 18.697 28.3595L12.6212 23.7303C11.3682 22.7757 9.63183 22.7757 8.37885 23.7303L2.30302 28.3595C1.9739 28.6103 1.5 28.3756 1.5 27.9618V2C1.5 1.72386 1.72386 1.5 2 1.5Z" stroke="currentColor" stroke-width="2.5"/>
                  </svg>
                  <span>#{settings_input_links}</span>
                </div>

                <div class="full-start__button selector button--reaction">
                  <svg width="38" height="34" viewBox="0 0 38 34" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M37.208 10.9742C37.1364 10.8013 37.0314 10.6441 36.899 10.5117C36.7666 10.3794 36.6095 10.2744 36.4365 10.2028L12.0658 0.108375C11.7166 -0.0361828 11.3242 -0.0361227 10.9749 0.108542C10.6257 0.253206 10.3482 0.530634 10.2034 0.879836L0.108666 25.2507C0.0369593 25.4236 3.37953e-05 25.609 2.3187e-08 25.7962C-3.37489e-05 25.9834 0.0368249 26.1688 0.108469 26.3418C0.180114 26.5147 0.28514 26.6719 0.417545 26.8042C0.54995 26.9366 0.707139 27.0416 0.880127 27.1131L17.2452 33.8917C17.5945 34.0361 17.9869 34.0361 18.3362 33.8917L29.6574 29.2017C29.8304 29.1301 29.9875 29.0251 30.1199 28.8928C30.2523 28.7604 30.3573 28.6032 30.4289 28.4303L37.2078 12.065C37.2795 11.8921 37.3164 11.7068 37.3164 11.5196C37.3165 11.3325 37.2796 11.1471 37.208 10.9742Z" fill="currentColor"/>
                  </svg>
                  <span>#{title_reactions}</span>
                </div>

                <div class="full-start__button selector button--options">
                  <svg width="38" height="10" viewBox="0 0 38 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="4.88968" cy="4.98563" r="4.75394" fill="currentColor"/>
                    <circle cx="18.9746" cy="4.98563" r="4.75394" fill="currentColor"/>
                    <circle cx="33.0596" cy="4.98563" r="4.75394" fill="currentColor"/>
                  </svg>
                </div>
              </div>
            </div>

            <div class="cardify__right">
              <div class="full-start-new__reactions selector"><div>#{reactions_none}</div></div>
              <div class="full-start-new__rate-line">
                <div class="full-start__pg hide"></div>
                <div class="full-start__status hide"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`);

      // CSS минимально
      addOnceStyle("cardify_css_v4", `
        .cardify{transition:all .3s}
        .cardify .full-start-new__body{height:80vh}
        .cardify .full-start-new__right{display:flex;align-items:flex-end}
        .cardify .full-start-new__title{text-shadow:0 0 .1em rgba(0,0,0,0.3)}
      `);

      // стили фона-видео на full (если включишь auto трейлер)
      addOnceStyle("cardify_bgtrailer_css_v4",
        ".cardify-bgtrailer{opacity:0;transition:opacity .25s;pointer-events:none;position:absolute;top:-60%;bottom:-60%;left:0;width:100%;display:flex;align-items:center;z-index:0}" +
        ".cardify-bgtrailer.display{opacity:1}" +
        ".cardify-bgtrailer iframe{border:0;width:100%;flex-shrink:0}"
      );
    }

    // -----------------------------
    // 2) New Interface styles (каталог)
    // -----------------------------
    function addStylesNewInterface() {
      addOnceStyle("new_interface_css_v4", `
        .new-interface{position:relative}
        .new-interface .new-interface-info__body{position:absolute;z-index:10;width:80%}
        .new-interface .full-start__background-wrapper{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0}
        .new-interface .full-start__background{position:absolute;height:108%;width:100%;top:-5em;left:0;opacity:0;object-fit:cover;transition:opacity .8s cubic-bezier(.4,0,.2,1)}
        .new-interface .full-start__background.active{opacity:.5}

        /* ВАЖНО: видео слой НЕ с отрицательным z-index (иначе на некоторых ТВ просто не рисуется) */
        .new-interface .new-interface-trailer{
          position:absolute;
          top:-55%;
          bottom:-55%;
          left:0;
          width:100%;
          pointer-events:none;
          opacity:0;
          transition:opacity .25s;
          z-index:1;
          display:flex;
          align-items:center;
        }
        .new-interface .new-interface-trailer.display{opacity:1}
        .new-interface .new-interface-trailer iframe{border:0;width:100%}
        .new-interface.trailer-on .full-start__background{opacity:0!important}

        /* если у тебя “поехал текст на карточках” — убираем лишние оверлеи, оставляем чистый постер */
        ${Lampa.Storage.get("hide_captions", true) ? `
          .new-interface .card:not(.card--collection) .card__age,
          .new-interface .card:not(.card--collection) .card__title,
          .new-interface .card:not(.card--collection) .card__text,
          .new-interface .card:not(.card--collection) .card__description{display:none!important}
        ` : ``}
      `);
    }

    // -----------------------------
    // 3) Catalog trailer player (главный фикс)
    // -----------------------------
    function CatalogTrailer(state) {
      this.state = state;
      this.wrapper = null;
      this.host = null;
      this.player = null;
      this.loaded = false;
      this.currentVideo = "";
      this.token = 0;
      this.timer = null;

      try { window.__final_catalog_trailers.push(this); } catch (e) {}
    }

    CatalogTrailer.prototype.enabled = function () {
      return Lampa.Storage.get("catalog_run_trailers", true) !== false;
    };

    CatalogTrailer.prototype.sound = function () {
      return Lampa.Storage.get("catalog_trailer_sound", false) === true;
    };

    CatalogTrailer.prototype.attach = function (container) {
      if (this.wrapper) return;

      this.wrapper = document.createElement("div");
      this.wrapper.className = "new-interface-trailer";

      this.host = document.createElement("div");
      this.wrapper.appendChild(this.host);

      // вставляем сразу после background wrapper (чтобы быть “между” фоном и UI)
      var bgw = container.querySelector(".full-start__background-wrapper");
      if (bgw && bgw.parentNode === container) {
        if (bgw.nextSibling) container.insertBefore(this.wrapper, bgw.nextSibling);
        else container.appendChild(this.wrapper);
      } else {
        container.insertBefore(this.wrapper, container.firstChild || null);
      }
    };

    CatalogTrailer.prototype._setUiState = function (playing) {
      try {
        var c = this.state.main.render(true);
        if (!c) return;

        if (playing) c.classList.add("trailer-on");
        else c.classList.remove("trailer-on");

        if (this.wrapper) {
          if (playing) this.wrapper.classList.add("display");
          else this.wrapper.classList.remove("display");
        }
      } catch (e) {}
    };

    CatalogTrailer.prototype.stop = function () {
      clearTimeout(this.timer);
      this.token++;
      this._setUiState(false);

      try {
        if (this.player && this.loaded) {
          this.player.pauseVideo();
          this.player.stopVideo();
          this.player.mute();
        }
      } catch (e) {}
    };

    CatalogTrailer.prototype.destroy = function () {
      clearTimeout(this.timer);
      this.token++;

      try {
        if (this.player) {
          try { this.player.stopVideo(); this.player.mute(); } catch (e0) {}
          if (this.player.destroy) this.player.destroy();
        }
      } catch (e) {}

      this.player = null;
      this.loaded = false;
      this.currentVideo = "";

      try { if (this.wrapper && this.wrapper.parentNode) this.wrapper.parentNode.removeChild(this.wrapper); } catch (e2) {}
      this.wrapper = null;
      this.host = null;
    };

    CatalogTrailer.prototype.playFor = function (cardData) {
      var self = this;

      if (!this.enabled()) return this.stop();
      if (!cardData || !cardData.id) return this.stop();

      // если мы уже в карточке/настройках/плеере — не стартуем
      if (hasBlockingOverlay()) return this.stop();

      var myToken = ++this.token;
      clearTimeout(this.timer);

      // debounce
      this.timer = setTimeout(function () {
        if (self.token !== myToken) return;
        if (hasBlockingOverlay()) return self.stop();

        ensureVideos(cardData, function (videos) {
          if (self.token !== myToken) return;
          if (hasBlockingOverlay()) return self.stop();

          var trailer = pickTrailer(videos);
          if (!trailer) return self.stop();

          ensureYT(function () {
            if (self.token !== myToken) return;
            if (hasBlockingOverlay()) return self.stop();

            function safeAutoplayStart() {
              // ВАЖНО: для автоплея почти всегда нужен mute
              try { self.player.mute(); } catch (e) {}

              // 1) сначала play muted
              try { self.player.playVideo(); } catch (e2) {}

              // 2) если включен звук — размьют ТОЛЬКО после старта
              if (self.sound()) {
                setTimeout(function () {
                  if (self.token !== myToken) return;
                  try { self.player.unMute(); } catch (e3) {}
                }, 600);
              }
            }

            if (!self.player) {
              self.player = new YT.Player(self.host, {
                height: window.innerHeight * 2,
                width: window.innerWidth,
                videoId: trailer.id,
                playerVars: {
                  controls: 0,
                  modestbranding: 1,
                  autoplay: 0,
                  disablekb: 1,
                  fs: 0,
                  playsinline: 1,
                  rel: 0,
                  iv_load_policy: 3,
                  enablejsapi: 1
                },
                events: {
                  onReady: function () {
                    self.loaded = true;
                    self.currentVideo = trailer.id;

                    // более надёжно: cue -> play
                    try { self.player.cueVideoById(trailer.id); } catch (e0) {}
                    setTimeout(function () {
                      if (self.token !== myToken) return;
                      safeAutoplayStart();
                    }, 150);
                  },
                  onStateChange: function (st) {
                    if (hasBlockingOverlay()) {
                      self.stop();
                      return;
                    }

                    if (st.data === YT.PlayerState.PLAYING) self._setUiState(true);
                    if (st.data === YT.PlayerState.PAUSED) self._setUiState(false);

                    if (st.data === YT.PlayerState.ENDED) {
                      try { self.player.seekTo(0, true); self.player.playVideo(); } catch (e1) {}
                    }

                    // если автоплей заблокировали — попробуем ещё раз muted
                    if (st.data === YT.PlayerState.UNSTARTED) {
                      setTimeout(function () {
                        if (self.token !== myToken) return;
                        if (hasBlockingOverlay()) return self.stop();
                        try { self.player.mute(); self.player.playVideo(); } catch (e2) {}
                      }, 500);
                    }
                  },
                  onError: function () {
                    self.stop();
                  }
                }
              });
              return;
            }

            // уже есть плеер — переключаем
            try {
              // сначала muted, чтобы точно стартанул
              try { self.player.mute(); } catch (e4) {}

              if (self.currentVideo !== trailer.id) {
                self.currentVideo = trailer.id;
                try {
                  self.player.loadVideoById(trailer.id);
                } catch (e5) {
                  // если load сломался — пересоздадим
                  try { self.player.destroy(); } catch (e6) {}
                  self.player = null;
                  self.loaded = false;
                  self.playFor(cardData);
                  return;
                }
              } else {
                safeAutoplayStart();
              }

              // размьют после старта, если надо
              if (self.sound()) {
                setTimeout(function () {
                  if (self.token !== myToken) return;
                  try { self.player.unMute(); } catch (e7) {}
                }, 600);
              }
            } catch (e8) {}
          });
        });
      }, 650);
    };

    // -----------------------------
    // 4) New interface state (фон + инфо + каталог трейлер)
    // -----------------------------
    function InfoPanel() {
      this.html = null;
    }
    InfoPanel.prototype.create = function () {
      this.html = $(`<div class="new-interface-info">
        <div class="new-interface-info__body">
          <div class="new-interface-info__title"></div>
          <div class="new-interface-info__details"></div>
          <div class="new-interface-info__description"></div>
        </div>
      </div>`);
    };
    InfoPanel.prototype.render = function (asElement) {
      if (!this.html) this.create();
      return asElement ? this.html[0] : this.html;
    };
    InfoPanel.prototype.update = function (data) {
      if (!data || !this.html) return;

      this.html.find(".new-interface-info__title").text(data.title || data.name || "");
      this.html.find(".new-interface-info__description").text(data.overview || "");

      var rating = parseFloat((data.vote_average || 0) + "").toFixed(1);
      var year = ((data.release_date || data.first_air_date || "0000") + "").slice(0, 4);

      var det = [];
      if (rating > 0) det.push(rating + " TMDB");
      if (year !== "0000") det.push(year);

      this.html.find(".new-interface-info__details").text(det.join(" • "));
    };
    InfoPanel.prototype.empty = function () {
      if (!this.html) return;
      this.html.find(".new-interface-info__title,.new-interface-info__details,.new-interface-info__description").text("");
    };
    InfoPanel.prototype.destroy = function () {
      if (this.html) { this.html.remove(); this.html = null; }
    };

    function createState(mainInstance) {
      var infoPanel = new InfoPanel();
      infoPanel.create();

      var backgroundWrapper = document.createElement("div");
      backgroundWrapper.className = "full-start__background-wrapper";

      var bg1 = document.createElement("img");
      bg1.className = "full-start__background";
      var bg2 = document.createElement("img");
      bg2.className = "full-start__background";

      backgroundWrapper.appendChild(bg1);
      backgroundWrapper.appendChild(bg2);

      var state = {
        main: mainInstance,
        info: infoPanel,
        background: backgroundWrapper,
        infoElement: null,
        backgroundTimer: null,
        backgroundLast: "",
        attached: false,
        catalogTrailer: null,

        attach: function () {
          if (this.attached) return;

          var container = mainInstance.render(true);
          if (!container) return;

          container.classList.add("new-interface");

          if (!backgroundWrapper.parentElement) {
            container.insertBefore(backgroundWrapper, container.firstChild || null);
          }

          if (!this.catalogTrailer) this.catalogTrailer = new CatalogTrailer(this);
          this.catalogTrailer.attach(container);

          var infoElement = infoPanel.render(true);
          this.infoElement = infoElement;

          if (infoElement && infoElement.parentNode !== container) {
            container.insertBefore(infoElement, backgroundWrapper.nextSibling);
          }

          try { mainInstance.scroll.minus(infoElement); } catch (e) {}
          this.attached = true;
        },

        update: function (data) {
          if (!data) return;

          infoPanel.update(data);
          this.updateBackground(data);

          if (this.catalogTrailer) {
            this.catalogTrailer.playFor(data);
          }
        },

        updateBackground: function (data) {
          var self = this;

          clearTimeout(this.backgroundTimer);

          var show_bg = Lampa.Storage.get("show_background", true);
          var backdropUrl = data && data.backdrop_path && show_bg ? Lampa.Api.img(data.backdrop_path, "original") : "";

          if (backdropUrl === this.backgroundLast) return;

          this.backgroundTimer = setTimeout(function () {
            if (!backdropUrl) {
              bg1.classList.remove("active");
              bg2.classList.remove("active");
              self.backgroundLast = "";
              return;
            }

            var nextLayer = bg1.classList.contains("active") ? bg2 : bg1;
            var prevLayer = bg1.classList.contains("active") ? bg1 : bg2;

            var img = new Image();
            img.onload = function () {
              if (backdropUrl !== self.backgroundLast) return;
              nextLayer.src = backdropUrl;
              nextLayer.classList.add("active");
              setTimeout(function () {
                if (backdropUrl !== self.backgroundLast) return;
                prevLayer.classList.remove("active");
              }, 100);
            };

            self.backgroundLast = backdropUrl;
            img.src = backdropUrl;
          }, 250);
        },

        reset: function () {
          infoPanel.empty();
          if (this.catalogTrailer) this.catalogTrailer.stop();
        },

        destroy: function () {
          clearTimeout(this.backgroundTimer);
          infoPanel.destroy();

          if (this.catalogTrailer) {
            try { this.catalogTrailer.destroy(); } catch (e) {}
            this.catalogTrailer = null;
          }

          var container = mainInstance.render(true);
          if (container) {
            container.classList.remove("new-interface");
            container.classList.remove("trailer-on");
          }

          if (this.infoElement && this.infoElement.parentNode) this.infoElement.parentNode.removeChild(this.infoElement);
          if (backgroundWrapper && backgroundWrapper.parentNode) backgroundWrapper.parentNode.removeChild(backgroundWrapper);

          this.attached = false;
        }
      };

      return state;
    }

    function getOrCreateState(createInstance) {
      if (createInstance.__newInterfaceState) return createInstance.__newInterfaceState;
      var s = createState(createInstance);
      createInstance.__newInterfaceState = s;
      return s;
    }

    function extendResultsWithStyle(data) {
      if (!data) return;
      if (Array.isArray(data.results)) {
        data.results.forEach(function (card) {
          if (card.wide !== false) card.wide = false;
        });
      }
    }

    function handleCard(state, card) {
      if (!card || card.__newInterfaceCard) return;
      if (typeof card.use !== "function" || !card.data) return;

      card.__newInterfaceCard = true;

      card.use({
        onFocus: function () { state.update(card.data); },
        onHover: function () { state.update(card.data); },
        onTouch: function () { state.update(card.data); },
        onDestroy: function () { delete card.__newInterfaceCard; }
      });
    }

    function getCardData(card, results, index) {
      index = index || 0;
      if (card && card.data) return card.data;
      if (results && Array.isArray(results.results)) return results.results[index] || results.results[0];
      return null;
    }

    function findCardData(element) {
      if (!element) return null;
      var node = element && element.jquery ? element[0] : element;
      while (node && !node.card_data) node = node.parentNode;
      return node && node.card_data ? node.card_data : null;
    }

    function getFocusedCard(items) {
      var container = items && typeof items.render === "function" ? items.render(true) : null;
      if (!container || !container.querySelector) return null;
      var focusedElement = container.querySelector(".selector.focus") || container.querySelector(".focus");
      return findCardData(focusedElement);
    }

    function handleLineAppend(items, line, data) {
      if (line.__newInterfaceLine) return;
      line.__newInterfaceLine = true;

      var state = getOrCreateState(items);

      // если ты хочешь 12 — можно вернуть, но на некоторых темах ломает рендер.
      // Сейчас оставляю как есть в Лампе, чтобы НЕ “летел текст”.
      extendResultsWithStyle(data);

      line.use({
        onInstance: function (instance) { handleCard(state, instance); },
        onActive: function (card, results) {
          var cd = getCardData(card, results);
          if (cd) state.update(cd);
        },
        onToggle: function () {
          setTimeout(function () {
            var focused = getFocusedCard(line);
            if (focused) state.update(focused);
          }, 32);
        },
        onMore: function () { state.reset(); },
        onDestroy: function () { state.reset(); delete line.__newInterfaceLine; }
      });

      if (Array.isArray(line.items) && line.items.length) line.items.forEach(function (c) { handleCard(state, c); });
    }

    // -----------------------------
    // Global stop events (чтобы звук каталога не оставался)
    // -----------------------------
    function installStopHooks() {
      // при открытии карточки
      Lampa.Listener.follow("full", function (e) {
        if (!e) return;
        if (e.type === "complite" || e.type === "complete") stopCatalogEverything(false);
      });

      // при открытии настроек
      Lampa.Settings.listener.follow("open", function () {
        stopCatalogEverything(false);
      });

      // на любые “переключения” проверяем: если появились оверлеи — стоп
      if (Lampa.Controller && Lampa.Controller.listener) {
        Lampa.Controller.listener.follow("toggle", function () {
          setTimeout(function () {
            if (hasBlockingOverlay()) stopCatalogEverything(false);
          }, 0);
        });
      }

      // activity start/active — тоже страхуемся
      Lampa.Listener.follow("activity", function (e) {
        if (!e) return;
        if (e.type === "start" || e.type === "active") {
          setTimeout(function () {
            if (hasBlockingOverlay()) stopCatalogEverything(false);
          }, 0);
        }
      });
    }

    // -----------------------------
    // Start
    // -----------------------------
    installCardify();
    addStylesNewInterface();
    installStopHooks();

    // -----------------------------
    // Hook Main maker
    // -----------------------------
    var mainMaker = Lampa.Maker.map("Main");
    if (!mainMaker || !mainMaker.Items || !mainMaker.Create) return;

    wrapMethod(mainMaker.Items, "onInit", function (originalMethod, args) {
      this.__newInterfaceEnabled = shouldEnableInterface(this && this.object);
      if (this.__newInterfaceEnabled) {
        if (this.object) this.object.wide = false;
        this.wide = false;
      }
      if (originalMethod) originalMethod.apply(this, args);
    });

    wrapMethod(mainMaker.Create, "onCreate", function (originalMethod, args) {
      if (originalMethod) originalMethod.apply(this, args);
      if (!this.__newInterfaceEnabled) return;

      var state = getOrCreateState(this);
      state.attach();
    });

    wrapMethod(mainMaker.Create, "onCreateAndAppend", function (originalMethod, args) {
      var data = args && args[0];
      if (this.__newInterfaceEnabled && data) {
        data.wide = false;
        extendResultsWithStyle(data);
      }
      return originalMethod ? originalMethod.apply(this, args) : undefined;
    });

    wrapMethod(mainMaker.Items, "onAppend", function (originalMethod, args) {
      if (originalMethod) originalMethod.apply(this, args);
      if (!this.__newInterfaceEnabled) return;

      var element = args && args[0];
      var data = args && args[1];

      if (element && data) handleLineAppend(this, element, data);
    });

    wrapMethod(mainMaker.Items, "onDestroy", function (originalMethod, args) {
      if (this.__newInterfaceState) {
        this.__newInterfaceState.destroy();
        delete this.__newInterfaceState;
      }
      delete this.__newInterfaceEnabled;
      if (originalMethod) originalMethod.apply(this, args);
    });
  }
})();
