(function () {
  "use strict";

  if (window.plugin_style_interface_cardify_final_v3) return;
  window.plugin_style_interface_cardify_final_v3 = true;

  // -----------------------------
  // Boot wait
  // -----------------------------
  var bootTimer = setInterval(function () {
    if (window.Lampa && window["app" + "re" + "ady"]) {
      clearInterval(bootTimer);
      try {
        init();
      } catch (e) {
        console.log("final plugin init error", e);
      }
    }
  }, 200);

  function init() {
    if (!window.Lampa) return;

    try { Lampa.Platform.tv(); } catch (e) {}

    if (!Lampa.Maker || !Lampa.Maker.map || !Lampa.Utils || !Lampa.Template) return;

    // -----------------------------
    // Utils / Shared
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

    function shouldEnableInterface(object) {
      if (!object) return false;
      if (window.innerWidth < 767) return false;
      if (Lampa.Platform.screen("mobile")) return false;
      if (object.title === "Избранное") return false;
      return true;
    }

    function wrapMethod(object, methodName, wrapper) {
      if (!object) return;
      var originalMethod = typeof object[methodName] === "function" ? object[methodName] : null;
      object[methodName] = function () {
        var args = Array.prototype.slice.call(arguments);
        return wrapper.call(this, originalMethod, args);
      };
    }

    // -----------------------------
    // Context detection (важно для каталожного видео)
    // -----------------------------
    function isCatalogVisibleNow() {
      try {
        var layer = document.querySelector(".layer--visible");
        if (!layer) return false;

        // Если поверх full
        if (layer.querySelector(".full-start-new") || layer.querySelector(".full-start")) return false;

        // Если поверх настройки
        if (layer.querySelector(".settings") || layer.querySelector(".settings__body") || layer.querySelector('[data-component="settings"]')) return false;

        // Каталог в нашем режиме всегда помечается .new-interface
        if (!layer.querySelector(".new-interface")) return false;

        return true;
      } catch (e) {
        return false;
      }
    }

    // -----------------------------
    // TMDB detail cache / coalescing
    // -----------------------------
    var globalInfoCache = {};
    var globalPending = {};

    function buildTmdbDetailUrl(data, append) {
      if (!data || !data.id) return "";
      if (!Lampa.TMDB || typeof Lampa.TMDB.api !== "function" || typeof Lampa.TMDB.key !== "function") return "";

      var source = data.source || "tmdb";
      if (source !== "tmdb" && source !== "cub") return "";

      var mediaType = data.media_type === "tv" || data.name ? "tv" : "movie";
      var language = Lampa.Storage.get("language") || Lampa.Storage.field("tmdb_lang") || "ru";

      return Lampa.TMDB.api(
        mediaType +
          "/" +
          data.id +
          "?api_key=" +
          Lampa.TMDB.key() +
          "&append_to_response=" +
          encodeURIComponent(append || "videos") +
          "&language=" +
          encodeURIComponent(language)
      );
    }

    function ensureDetails(data, append, cb) {
      var url = buildTmdbDetailUrl(data, append);
      if (!url) return cb(null);

      if (globalInfoCache[url]) return cb(globalInfoCache[url]);

      if (globalPending[url]) {
        globalPending[url].push(cb);
        return;
      }

      globalPending[url] = [cb];

      var req = new Lampa.Reguest();
      req.silent(
        url,
        function (resp) {
          globalInfoCache[url] = resp;
          var arr = globalPending[url] || [];
          delete globalPending[url];
          arr.forEach(function (fn) { try { fn(resp); } catch (e) {} });
        },
        function () {
          var arr2 = globalPending[url] || [];
          delete globalPending[url];
          arr2.forEach(function (fn) { try { fn(null); } catch (e) {} });
        }
      );
    }

    function pickTrailerFromDetails(details) {
      if (!details || !details.videos || !details.videos.results || !details.videos.results.length) return null;

      var items = [];
      details.videos.results.forEach(function (v) {
        if (!v || !v.key) return;
        if (v.site && (v.site + "").toLowerCase() !== "youtube") return;

        items.push({
          id: v.key,
          code: v.iso_639_1,
          type: (v.type || "").toLowerCase(),
          time: v.published_at ? new Date(v.published_at).getTime() : 0,
        });
      });

      if (!items.length) return null;

      var lang = "";
      try { lang = Lampa.Storage.field("tmdb_lang") || Lampa.Storage.get("language") || "ru"; } catch (e) {}

      items.sort(function (a, b) {
        var ap = a.type === "trailer" ? 2 : a.type === "teaser" ? 1 : 0;
        var bp = b.type === "trailer" ? 2 : b.type === "teaser" ? 1 : 0;
        if (ap !== bp) return bp - ap;
        if (a.time !== b.time) return b.time - a.time;
        return 0;
      });

      var my = items.filter(function (x) { return x.code === lang; });
      var en = items.filter(function (x) { return x.code === "en"; });

      return my[0] || en[0] || items[0] || null;
    }

    // -----------------------------
    // Global stop helpers (catalog trailer)
    // -----------------------------
    if (!window.__final_catalog_trailers) window.__final_catalog_trailers = [];

    function stopAllCatalogTrailers(opts) {
      var destroy = opts && opts.destroy;

      try {
        window.__final_catalog_trailers = (window.__final_catalog_trailers || []).filter(Boolean);

        window.__final_catalog_trailers.forEach(function (t) {
          try { destroy ? t.destroy() : t.stop(); } catch (e) {}
        });

        if (destroy) window.__final_catalog_trailers = [];
      } catch (e2) {}
    }

    function stopCatalogYoutubeIframes() {
      try {
        var frames = document.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"]');

        frames.forEach(function (fr) {
          // не трогаем full/Cardify
          if (fr.closest(".full-start-new, .cardify, .cardify-bgtrailer")) return;

          try {
            fr.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', "*");
            fr.contentWindow.postMessage('{"event":"command","func":"stopVideo","args":""}', "*");
            fr.contentWindow.postMessage('{"event":"command","func":"mute","args":""}', "*");
          } catch (e) {}

          // страховка
          try {
            var src = fr.getAttribute("src") || "";
            if (src) fr.setAttribute("src", src);
          } catch (e2) {}
        });
      } catch (e3) {}
    }

    function stopCatalogAudioEverywhere(opts) {
      stopAllCatalogTrailers(opts);
      stopCatalogYoutubeIframes();
    }

    // -----------------------------
    // 1) CARDIFY TEMPLATE + CSS
    // -----------------------------
    function installCardifyTemplateAndCss() {
      // (тот же template, что ты давал — чтобы кнопки снова были минималистичными)
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
                    <path d="M37.208 10.9742C37.1364 10.8013 37.0314 10.6441 36.899 10.5117C36.7666 10.3794 36.6095 10.2744 36.4365 10.2028L12.0658 0.108375C11.7166 -0.0361828 11.3242 -0.0361227 10.9749 0.108542C10.6257 0.253206 10.3482 0.530634 10.2034 0.879836L0.108666 25.2507C0.0369593 25.4236 3.37953e-05 25.609 2.3187e-08 25.7962C-3.37489e-05 25.9834 0.0368249 26.1688 0.108469 26.3418C0.180114 26.5147 0.28514 26.6719 0.417545 26.8042C0.54995 26.9366 0.707139 27.0416 0.880127 27.1131L17.2452 33.8917C17.5945 34.0361 17.9869 34.0361 18.3362 33.8917L29.6574 29.2017C29.8304 29.1301 29.9875 29.0251 30.1199 28.8928C30.2523 28.7604 30.3573 28.6032 30.4289 28.4303L37.2078 12.065C37.2795 11.8921 37.3164 11.7068 37.3164 11.5196C37.3165 11.3325 37.2796 11.1471 37.208 10.9742ZM20.425 29.9407L21.8784 26.4316L25.3873 27.885L20.425 29.9407ZM28.3407 26.0222L21.6524 23.252C21.3031 23.1075 20.9107 23.1076 20.5615 23.2523C20.2123 23.3969 19.9348 23.6743 19.79 24.0235L17.0194 30.7123L3.28783 25.0247L12.2918 3.28773L34.0286 12.2912L28.3407 26.0222Z" fill="currentColor"/>
                    <path d="M25.3493 16.976L24.258 14.3423L16.959 17.3666L15.7196 14.375L13.0859 15.4659L15.4161 21.0916L25.3493 16.976Z" fill="currentColor"/>
                  </svg>
                  <span>#{title_reactions}</span>
                </div>

                <div class="full-start__button selector button--subscribe hide">
                  <svg width="25" height="30" viewBox="0 0 25 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7367 27 9.27804 25.6961 9.03542 24H6.01892Z" fill="currentColor"/>
                    <path d="M3.81972 14.5957V10.2679C3.81972 5.41336 7.7181 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.2106 22.9392 23.5 20.9098 23.5H4.09021C2.06084 23.5 0.792282 21.2106 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z" stroke="currentColor" stroke-width="2.5"/>
                  </svg>
                  <span>#{title_subscribe}</span>
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

        <div class="hide buttons--container">
          <div class="full-start__button selector view--trailer">
            <svg height="70" viewBox="0 0 80 70" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M71.2555 2.08955C74.6975 3.2397 77.4083 6.62804 78.3283 10.9306C80 18.7291 80 35 80 35C80 35 80 51.2709 78.3283 59.0694C77.4083 63.372 74.6975 66.7603 71.2555 67.9104C65.0167 70 40 70 40 70C40 70 14.9833 70 8.74453 67.9104C5.3025 66.7603 2.59172 63.372 1.67172 59.0694C0 51.2709 0 35 0 35C0 35 0 18.7291 1.67172 10.9306C2.59172 6.62804 5.3025 3.2395 8.74453 2.08955C14.9833 0 40 0 40 0C40 0 65.0167 0 71.2555 2.08955ZM55.5909 35.0004L29.9773 49.5714V20.4286L55.5909 35.0004Z" fill="currentColor"></path>
            </svg>
            <span>#{full_trailers}</span>
          </div>
        </div>
      </div>`);

      Lampa.Template.add("cardify_css", `
        <style>
          .cardify{transition:all .3s}
          .cardify .full-start-new__body{height:80vh}
          .cardify .full-start-new__right{display:flex;align-items:flex-end}
          .cardify .full-start-new__title{text-shadow:0 0 .1em rgba(0,0,0,0.3)}
          .cardify__left{flex-grow:1}
          .cardify__right{display:flex;align-items:center;flex-shrink:0;position:relative}
          .cardify__details{display:flex}
          .cardify .full-start-new__reactions{margin:0;margin-right:-2.8em}
          .cardify .full-start-new__reactions:not(.focus)>div:not(:first-child){display:none}
          .cardify .full-start-new__rate-line{margin:0;margin-left:3.5em}
          body:not(.menu--open) .cardify__background{
            -webkit-mask-image:linear-gradient(to bottom,white 50%,rgba(255,255,255,0) 100%);
            mask-image:linear-gradient(to bottom,white 50%,rgba(255,255,255,0) 100%);
          }
        </style>
      `);
      $("body").append(Lampa.Template.get("cardify_css", {}, true));

      addOnceStyle(
        "final_cardify_bgtrailer_css",
        ".cardify-bgtrailer{opacity:0;transition:opacity .25s;pointer-events:none;position:absolute;top:-60%;bottom:-60%;left:0;width:100%;display:flex;align-items:center;z-index:0}" +
          ".cardify-bgtrailer.display{opacity:1}" +
          ".cardify-bgtrailer iframe{border:0;width:100%;flex-shrink:0}" +
          ".full-start__background{overflow:hidden}" +
          ".full-start__background.cardify-bgtrailer--on{background-image:none!important}" +
          ".full-start__background.cardify-bgtrailer--on>img{opacity:0!important;transition:opacity .2s}"
      );
    }

    // -----------------------------
    // 2) Cardify full-page background trailer (auto)
    // -----------------------------
    function BgPlayer(activity, video, opts) {
      var _this = this;
      this.activity = activity;
      this.video = video;
      this.opts = opts || {};
      this.loaded = false;

      this.root = activity.render();
      this.bg = this.root.find(".full-start__background").eq(0);
      this.bgTag = this.bg.length ? (this.bg[0].tagName || "").toLowerCase() : "";
      this.bgIsImg = this.bgTag === "img";

      this.html = $('<div class="cardify-bgtrailer"><div class="cardify-bgtrailer__iframe"></div></div>');

      if (this.bg.length) {
        if (this.bgIsImg) this.bg.after(this.html);
        else this.bg.append(this.html);
      } else {
        this.root.find(".activity__body").prepend(this.html);
      }

      this.iframeHost = this.html.find(".cardify-bgtrailer__iframe");

      ensureYT(function () {
        if (!_this.iframeHost.length) return;

        _this.youtube = new YT.Player(_this.iframeHost[0], {
          height: window.innerHeight * 2,
          width: window.innerWidth,
          videoId: _this.video.id,
          playerVars: {
            controls: 0,
            modestbranding: 1,
            autoplay: 0,
            disablekb: 1,
            fs: 0,
            enablejsapi: 1,
            playsinline: 1,
            rel: 0,
            iv_load_policy: 3,
          },
          events: {
            onReady: function () {
              _this.loaded = true;
              try { _this.youtube.setPlaybackQuality("hd1080"); } catch (e) {}
              try { (_this.opts.sound === false) ? _this.youtube.mute() : _this.youtube.unMute(); } catch (e2) {}
            },
            onStateChange: function (state) {
              if (state.data === YT.PlayerState.PLAYING) {
                _this.html.addClass("display");
                _this.setStaticHidden(true);
              }
              if (state.data === YT.PlayerState.PAUSED) {
                _this.html.removeClass("display");
                _this.setStaticHidden(false);
              }
              if (state.data === YT.PlayerState.ENDED) {
                try { _this.youtube.seekTo(0, true); _this.youtube.playVideo(); } catch (e3) {}
              }
            },
            onError: function () {
              _this.setStaticHidden(false);
              _this.destroy();
            },
          },
        });
      });
    }

    BgPlayer.prototype.setStaticHidden = function (hide) {
      try {
        if (!this.bg || !this.bg.length) return;
        this.bg.toggleClass("cardify-bgtrailer--on", !!hide);

        var img = this.bgIsImg ? this.bg : this.bg.find("img").eq(0);
        if (img && img.length) img.css("opacity", hide ? "0" : "");
      } catch (e) {}
    };
    BgPlayer.prototype.play = function () { if (this.loaded) try { this.youtube.playVideo(); } catch (e) {} };
    BgPlayer.prototype.pause = function () { if (this.loaded) try { this.youtube.pauseVideo(); } catch (e) {} };
    BgPlayer.prototype.destroy = function () {
      this.loaded = false;
      try { this.setStaticHidden(false); } catch (e) {}
      try { if (this.youtube && this.youtube.destroy) this.youtube.destroy(); } catch (e2) {}
      try { this.html.remove(); } catch (e3) {}
    };

    function BgTrailer(object, video, opts) {
      var _this = this;

      object.activity.trailer_ready = true;
      this.object = object;
      this.player = new BgPlayer(object.activity, video, opts || {});

      this.timelauch = 1200;
      this.firstlauch = false;
      this.timerCheck = null;

      this.onToggle = function () { _this.update(); };
      this.onActivity = function (e) { if (e.type === "destroy" && e.object.activity === _this.object.activity) _this.destroy(); };

      Lampa.Controller.listener.follow("toggle", this.onToggle);
      Lampa.Listener.follow("activity", this.onActivity);

      this.start();
    }

    BgTrailer.prototype.same = function () {
      try { return Lampa.Activity.active().activity === this.object.activity; } catch (e) { return false; }
    };
    BgTrailer.prototype.isTopView = function () {
      try {
        var name = Lampa.Controller.enabled().name;
        if (name && name !== "full_start") return false;
      } catch (e) {}
      return true;
    };
    BgTrailer.prototype.update = function () {
      if (!this.same()) return this.player.pause();
      if (!this.isTopView()) return this.player.pause();
      this.player.play();
    };
    BgTrailer.prototype.start = function () {
      var _this = this;

      clearInterval(this.timerCheck);
      this.timerCheck = setInterval(function () { _this.update(); }, 250);

      clearTimeout(this.timerLoad);
      this.timerLoad = setTimeout(function () {
        if (_this.same() && _this.isTopView()) {
          _this.player.play();
          if (!_this.firstlauch) { _this.firstlauch = true; _this.timelauch = 5000; }
        }
      }, this.timelauch);
    };
    BgTrailer.prototype.destroy = function () {
      clearTimeout(this.timerLoad);
      clearInterval(this.timerCheck);
      try { Lampa.Controller.listener.remove("toggle", this.onToggle); } catch (e) {}
      try { Lampa.Listener.remove("activity", this.onActivity); } catch (e2) {}
      try { this.player.destroy(); } catch (e3) {}
    };

    function hookFullAutoTrailer() {
      if (!Lampa.Listener) return;

      Lampa.Listener.follow("full", function (e) {
        if (!e) return;
        if (!(e.type === "complite" || e.type === "complete")) return;

        // при входе в карточку — стопаем каталог
        stopCatalogAudioEverywhere({ destroy: false });

        if (!Lampa.Storage.get("cardify_run_trailers", true)) return;
        if (!e.object || !e.object.activity) return;
        if (e.object.activity.trailer_ready) return;

        try {
          e.object.activity.render().find(".full-start__background").addClass("cardify__background");
        } catch (err2) {}

        ensureDetails(e.data, "videos", function (details) {
          var tr = pickTrailerFromDetails(details);
          if (!tr) return;

          var sound = Lampa.Storage.get("cardify_trailer_sound", true) !== false;

          if (Lampa.Activity.active().activity === e.object.activity) {
            new BgTrailer(e.object, tr, { sound: sound });
          } else {
            var follow = function (a) {
              if (a.type === "start" && a.object.activity === e.object.activity && !e.object.activity.trailer_ready) {
                Lampa.Listener.remove("activity", follow);
                new BgTrailer(e.object, tr, { sound: sound });
              }
            };
            Lampa.Listener.follow("activity", follow);
          }
        });
      });
    }

    // -----------------------------
    // 3) New Interface styles + catalog trailer layers
    // -----------------------------
    function addStylesNewInterface() {
      if (addStylesNewInterface.added) return;
      addStylesNewInterface.added = true;

      var styles = Lampa.Storage.get("wide_post") !== false ? getWideStyles() : getSmallStyles();
      Lampa.Template.add("new_interface_style_final_v3", styles);
      $("body").append(Lampa.Template.get("new_interface_style_final_v3", {}, true));

      // ВАЖНО: iframe должен быть видимым и достаточно большим
      addOnceStyle(
        "new_interface_trailer_layers_css_v3",
        ".new-interface{position:relative;z-index:0}" +
          ".new-interface .full-start__background-wrapper{z-index:-3}" +
          ".new-interface .new-interface-trailer{position:absolute;top:-60%;bottom:-60%;left:0;width:100%;pointer-events:none;opacity:0;transition:opacity .25s;z-index:-2;display:flex;align-items:center}" +
          ".new-interface .new-interface-trailer.display{opacity:1}" +
          ".new-interface .new-interface-trailer iframe{border:0;width:100%;height:" + (window.innerHeight * 2) + "px;}" +
          ".new-interface .full-start__background{transition:opacity .2s}" +
          ".new-interface.trailer-on .full-start__background{opacity:0!important}"
      );
    }

    function getWideStyles() {
      return `<style>
        .items-line{padding-bottom:4em!important}
        .new-interface-info__head, .new-interface-info__details{opacity:0;transition:opacity .5s ease;min-height:2.2em!important}
        .new-interface-info__head.visible, .new-interface-info__details.visible{opacity:1}
        .new-interface .card.card--wide,.new-interface .card.card--small{width:18.3em}
        .new-interface-info{position:relative;padding:1.5em;height:27.5em}
        .new-interface-info__body{position:absolute;z-index:9999999;width:80%;padding-top:1.1em}
        .new-interface-info__title{font-size:4em;font-weight:600;margin-bottom:.3em;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;line-height:1.3}
        .new-interface-info__details{margin-top:1.2em;margin-bottom:1.6em;display:flex;align-items:center;flex-wrap:wrap;font-size:1.3em}
        .new-interface-info__description{font-size:1.4em;font-weight:310;line-height:1.3;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;width:65%}
        .new-interface .full-start__background-wrapper{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
        .new-interface .full-start__background{position:absolute;height:108%;width:100%;top:-5em;left:0;opacity:0;object-fit:cover;transition:opacity .8s cubic-bezier(.4,0,.2,1)}
        .new-interface .full-start__background.active{opacity:.5}
        ${Lampa.Storage.get("hide_captions", true) ? ".card:not(.card--collection) .card__age, .card:not(.card--collection) .card__title{display:none!important}" : ""}
      </style>`;
    }

    function getSmallStyles() {
      return `<style>
        .new-interface-info__head, .new-interface-info__details{opacity:0;transition:opacity .5s ease;min-height:2.2em!important}
        .new-interface-info__head.visible, .new-interface-info__details.visible{opacity:1}
        .new-interface .card.card--wide{width:18.3em}
        .new-interface-info{position:relative;padding:1.5em;height:19.8em}
        .new-interface-info__body{position:absolute;z-index:9999999;width:80%;padding-top:.2em}
        .new-interface-info__title{font-size:3em;font-weight:600;margin-bottom:.2em;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;line-height:1.3}
        .new-interface-info__details{margin-top:1.2em;margin-bottom:1.6em;display:flex;align-items:center;flex-wrap:wrap;font-size:1.2em}
        .new-interface-info__description{font-size:1.3em;font-weight:310;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;width:70%}
        .new-interface .full-start__background-wrapper{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
        .new-interface .full-start__background{position:absolute;height:108%;width:100%;top:-5em;left:0;opacity:0;object-fit:cover;transition:opacity .8s cubic-bezier(.4,0,.2,1)}
        .new-interface .full-start__background.active{opacity:.5}
        ${Lampa.Storage.get("hide_captions", true) ? ".card:not(.card--collection) .card__age, .card:not(.card--collection) .card__title{display:none!important}" : ""}
      </style>`;
    }

    // -----------------------------
    // 4) Catalog trailer controller (исправлено)
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
      this.pendingData = null;

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

      this.pendingData = cardData;

      if (!this.enabled()) return this.stop();
      if (!cardData || !cardData.id) return this.stop();

      var myToken = ++this.token;
      clearTimeout(this.timer);

      // небольшой debounce, чтобы не дергать YouTube при быстрой навигации
      this.timer = setTimeout(function () {
        if (self.token !== myToken) return;

        // КЛЮЧЕВО: запускаем только если реально виден каталог
        if (!isCatalogVisibleNow()) return self.stop();

        ensureDetails(cardData, "videos", function (details) {
          if (self.token !== myToken) return;
          if (!isCatalogVisibleNow()) return self.stop();

          var trailer = pickTrailerFromDetails(details);
          if (!trailer) return self.stop();

          ensureYT(function () {
            if (self.token !== myToken) return;
            if (!isCatalogVisibleNow()) return self.stop();

            function applySoundSafe() {
              try {
                if (!self.player) return;

                // Для автоплея на ТВ/браузерах чаще нужно стартовать muted
                self.player.mute();
                if (self.sound()) self.player.unMute();
              } catch (e) {}
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
                  enablejsapi: 1,
                },
                events: {
                  onReady: function () {
                    self.loaded = true;
                    self.currentVideo = trailer.id;

                    applySoundSafe();
                    try { self.player.setPlaybackQuality("hd1080"); } catch (e) {}

                    // СТАРТ
                    try { self.player.playVideo(); } catch (e2) {}
                  },
                  onStateChange: function (st) {
                    if (!isCatalogVisibleNow()) {
                      self.stop();
                      return;
                    }

                    if (st.data === YT.PlayerState.PLAYING) self._setUiState(true);
                    if (st.data === YT.PlayerState.PAUSED) self._setUiState(false);
                    if (st.data === YT.PlayerState.ENDED) {
                      try { self.player.seekTo(0, true); self.player.playVideo(); } catch (e3) {}
                    }
                  },
                  onError: function () {
                    self.stop();
                  },
                },
              });
              return;
            }

            applySoundSafe();

            if (self.currentVideo !== trailer.id) {
              self.currentVideo = trailer.id;
              try {
                self.player.loadVideoById(trailer.id);
              } catch (e4) {
                try { self.player.destroy(); } catch (e5) {}
                self.player = null;
                self.loaded = false;
                self.playFor(cardData);
                return;
              }
            }

            try { self.player.playVideo(); } catch (e6) {}
          });
        });
      }, 650);
    };

    // -----------------------------
    // 5) InfoPanel (с showLogo полностью) — без изменений по сути
    // -----------------------------
    function InfoPanel() {
      this.html = null;
      this.timer = null;
      this.fadeTimer = null;
      this.network = new Lampa.Reguest();
      this.loaded = globalInfoCache;
      this.currentUrl = null;
      this.lastRenderId = 0;
    }

    InfoPanel.prototype.create = function () {
      this.html = $(`<div class="new-interface-info">
        <div class="new-interface-info__body">
          <div class="new-interface-info__head"></div>
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

      this.lastRenderId = Date.now();
      var currentRenderId = this.lastRenderId;

      this.html.find(".new-interface-info__head,.new-interface-info__details").removeClass("visible");

      var title = this.html.find(".new-interface-info__title");
      var desc = this.html.find(".new-interface-info__description");

      desc.text(data.overview || Lampa.Lang.translate("full_notext"));

      clearTimeout(this.fadeTimer);

      try { Lampa.Background.change(Lampa.Api.img(data.backdrop_path, "original")); } catch (e) {}

      this.load(data);

      if (Lampa.Storage.get("logo_show", true)) {
        title.text(data.title || data.name || "");
        title.css({ opacity: 1 });
        this.showLogo(data, currentRenderId);
      } else {
        title.text(data.title || data.name || "");
        title.css({ opacity: 1 });
      }
    };

    // showLogo — оставлен как у тебя (чтобы в каталоге заменяло название на логотип)
    InfoPanel.prototype.showLogo = function (data, renderId) {
      var _this = this;

      var FADE_OUT_TEXT = 300;
      var MORPH_HEIGHT = 400;
      var FADE_IN_IMG = 400;
      var TARGET_WIDTH = "7em";
      var PADDING_TOP_EM = 0;
      var PADDING_BOTTOM_EM = 0.2;

      var title_elem = this.html.find(".new-interface-info__title");
      var head_elem = this.html.find(".new-interface-info__head");
      var details_elem = this.html.find(".new-interface-info__details");
      var dom_title = title_elem[0];

      function applyFinalStyles(img, text_height) {
        img.style.marginTop = "0";
        img.style.marginLeft = "0";
        img.style.paddingTop = PADDING_TOP_EM + "em";
        img.style.paddingBottom = PADDING_BOTTOM_EM + "em";
        img.style.imageRendering = "-webkit-optimize-contrast";

        if (text_height) {
          img.style.height = text_height + "px";
          img.style.width = "auto";
          img.style.maxWidth = "100%";
          img.style.maxHeight = "none";
        } else if (window.innerWidth < 768) {
          img.style.width = "100%";
          img.style.height = "auto";
          img.style.maxWidth = "100%";
          img.style.maxHeight = "none";
        } else {
          img.style.width = TARGET_WIDTH;
          img.style.height = "auto";
          img.style.maxHeight = "none";
          img.style.maxWidth = "100%";
        }

        img.style.boxSizing = "border-box";
        img.style.display = "block";
        img.style.objectFit = "contain";
        img.style.objectPosition = "left bottom";
        img.style.transition = "none";
      }

      function moveHeadToDetails(animate) {
        if (!head_elem.length || !details_elem.length) return;
        if (details_elem.find(".logo-moved-head").length > 0) return;

        var content = head_elem.html();
        if (!content || content.trim() === "") return;

        var new_item = $('<span class="logo-moved-head">' + content + "</span>");
        var separator = $('<span class="new-interface-info__split logo-moved-separator">●</span>');

        if (animate) {
          new_item.css({ opacity: 0, transition: "none" });
          separator.css({ opacity: 0, transition: "none" });
        }

        if (details_elem.children().length > 0) details_elem.append(separator);
        details_elem.append(new_item);

        if (animate) {
          head_elem.css({ transition: "opacity " + FADE_OUT_TEXT / 1000 + "s ease", opacity: "0" });

          setTimeout(function () {
            new_item.css({ transition: "opacity " + FADE_IN_IMG / 1000 + "s ease", opacity: "1" });
            separator.css({ transition: "opacity " + FADE_IN_IMG / 1000 + "s ease", opacity: "1" });
          }, FADE_OUT_TEXT);
        } else {
          head_elem.css({ opacity: "0", transition: "none" });
        }
      }

      function startLogoAnimation(img_url, fromCache) {
        if (renderId && renderId !== _this.lastRenderId) return;

        var img = new Image();
        img.src = img_url;

        var start_text_height = 0;
        if (dom_title) start_text_height = dom_title.getBoundingClientRect().height;

        if (fromCache) {
          if (dom_title) start_text_height = dom_title.getBoundingClientRect().height;
          moveHeadToDetails(false);
          applyFinalStyles(img, start_text_height);
          title_elem.empty().append(img);
          title_elem.css({ opacity: "1", transition: "none" });
          img.style.opacity = "1";
          return;
        }

        applyFinalStyles(img, start_text_height);
        img.style.opacity = "0";

        img.onload = function () {
          if (renderId && renderId !== _this.lastRenderId) return;

          setTimeout(function () {
            if (renderId && renderId !== _this.lastRenderId) return;

            if (dom_title) start_text_height = dom_title.getBoundingClientRect().height;

            moveHeadToDetails(true);

            title_elem.css({ transition: "opacity " + FADE_OUT_TEXT / 1000 + "s ease", opacity: "0" });

            setTimeout(function () {
              if (renderId && renderId !== _this.lastRenderId) return;

              title_elem.empty();
              title_elem.append(img);
              title_elem.css({ opacity: "1", transition: "none" });

              var target_container_height = dom_title.getBoundingClientRect().height;

              dom_title.style.height = start_text_height + "px";
              dom_title.style.display = "block";
              dom_title.style.overflow = "hidden";
              dom_title.style.boxSizing = "border-box";

              void dom_title.offsetHeight;

              dom_title.style.transition = "height " + MORPH_HEIGHT / 1000 + "s cubic-bezier(0.4, 0, 0.2, 1)";

              requestAnimationFrame(function () {
                if (renderId && renderId !== _this.lastRenderId) return;
                dom_title.style.height = target_container_height + "px";

                setTimeout(function () {
                  if (renderId && renderId !== _this.lastRenderId) return;
                  img.style.transition = "opacity " + FADE_IN_IMG / 1000 + "s ease";
                  img.style.opacity = "1";
                }, Math.max(0, MORPH_HEIGHT - 100));

                setTimeout(function () {
                  if (renderId && renderId !== _this.lastRenderId) return;
                  applyFinalStyles(img, start_text_height);
                  dom_title.style.height = "";
                }, MORPH_HEIGHT + FADE_IN_IMG + 50);
              });
            }, FADE_OUT_TEXT);
          }, 200);
        };

        img.onerror = function () { title_elem.css({ opacity: "1", transition: "none" }); };
      }

      if (data.id) {
        var type = data.name ? "tv" : "movie";
        var language = Lampa.Storage.get("language");
        var cache_key = "logo_cache_v2_" + type + "_" + data.id + "_" + language;
        var cached_url = Lampa.Storage.get(cache_key);

        if (cached_url && cached_url !== "none") {
          startLogoAnimation(cached_url, true);
        } else {
          var url = Lampa.TMDB.api(
            type + "/" + data.id + "/images?api_key=" + Lampa.TMDB.key() + "&include_image_language=" + language + ",en,null"
          );

          $.get(url, function (data_api) {
            if (renderId && renderId !== _this.lastRenderId) return;

            var final_logo = null;
            if (data_api.logos && data_api.logos.length > 0) {
              for (var i = 0; i < data_api.logos.length; i++) {
                if (data_api.logos[i].iso_639_1 == language) { final_logo = data_api.logos[i].file_path; break; }
              }
              if (!final_logo) {
                for (var j = 0; j < data_api.logos.length; j++) {
                  if (data_api.logos[j].iso_639_1 == "en") { final_logo = data_api.logos[j].file_path; break; }
                }
              }
              if (!final_logo) final_logo = data_api.logos[0].file_path;
            }

            if (final_logo) {
              var img_url = Lampa.TMDB.image("/t/p/original" + final_logo.replace(".svg", ".png"));
              Lampa.Storage.set(cache_key, img_url);
              startLogoAnimation(img_url, false);
            } else {
              Lampa.Storage.set(cache_key, "none");
            }
          }).fail(function () {});
        }
      }
    };

    InfoPanel.prototype.load = function (data) {
      if (!data || !data.id) return;

      var apiUrl = buildTmdbDetailUrl(data, "content_ratings,release_dates,videos");
      if (!apiUrl) return;

      this.currentUrl = apiUrl;

      if (this.loaded[apiUrl]) {
        this.draw(this.loaded[apiUrl]);
        return;
      }

      clearTimeout(this.timer);
      var self = this;

      this.timer = setTimeout(function () {
        self.network.clear();
        self.network.timeout(5000);
        self.network.silent(apiUrl, function (response) {
          self.loaded[apiUrl] = response;
          if (self.currentUrl === apiUrl) self.draw(response);
        });
      }, 250);
    };

    InfoPanel.prototype.draw = function (data) {
      if (!data || !this.html) return;

      if (data.overview) this.html.find(".new-interface-info__description").text(data.overview);

      var year = ((data.release_date || data.first_air_date || "0000") + "").slice(0, 4);
      var rating = parseFloat((data.vote_average || 0) + "").toFixed(1);

      var detailsInfo = [];
      if (rating > 0) detailsInfo.push('<div class="full-start__rate"><div>' + rating + '</div><div>TMDB</div></div>');

      if (data.genres && data.genres.length) {
        detailsInfo.push(data.genres.slice(0, 2).map(function (g) { return Lampa.Utils.capitalizeFirstLetter(g.name); }).join(" | "));
      }

      if (data.runtime) detailsInfo.push(Lampa.Utils.secondsToTime(data.runtime * 60, true));

      var yc = [];
      if (year !== "0000") yc.push("<span>" + year + "</span>");
      try {
        var countries = (Lampa.Api.sources.tmdb.parseCountries(data) || []);
        if (countries.length > 2) countries = countries.slice(0, 2);
        if (countries.length) yc.push(countries.join(", "));
      } catch (e) {}

      if (yc.length) detailsInfo.push(yc.join(", "));

      this.html.find(".new-interface-info__details").html(detailsInfo.join('<span class="new-interface-info__split">&#9679;</span>')).addClass("visible");
    };

    InfoPanel.prototype.empty = function () {
      if (!this.html) return;
      this.html.find(".new-interface-info__head,.new-interface-info__details").text("").removeClass("visible");
    };

    InfoPanel.prototype.destroy = function () {
      clearTimeout(this.timer);
      this.network.clear();
      this.currentUrl = null;
      if (this.html) { this.html.remove(); this.html = null; }
    };

    // -----------------------------
    // 6) State for Main (new interface)
    // -----------------------------
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

          if (!backgroundWrapper.parentElement) container.insertBefore(backgroundWrapper, container.firstChild || null);

          if (!this.catalogTrailer) this.catalogTrailer = new CatalogTrailer(this);
          this.catalogTrailer.attach(container);

          var infoElement = infoPanel.render(true);
          this.infoElement = infoElement;

          if (infoElement && infoElement.parentNode !== container) {
            if (backgroundWrapper.parentElement === container) container.insertBefore(infoElement, backgroundWrapper.nextSibling);
            else container.insertBefore(infoElement, container.firstChild || null);
          }

          mainInstance.scroll.minus(infoElement);
          this.attached = true;
        },

        update: function (data) {
          if (!data) return;

          infoPanel.update(data);
          this.updateBackground(data);

          if (this.catalogTrailer) {
            if (Lampa.Storage.get("catalog_run_trailers", true) !== false) this.catalogTrailer.playFor(data);
            else this.catalogTrailer.stop();
          }
        },

        updateBackground: function (data) {
          var BACKGROUND_DEBOUNCE_DELAY = 250;
          var self = this;

          clearTimeout(this.backgroundTimer);

          var show_bg = Lampa.Storage.get("show_background", true);
          var bg_resolution = Lampa.Storage.get("background_resolution", "original");
          var backdropUrl = data && data.backdrop_path && show_bg ? Lampa.Api.img(data.backdrop_path, bg_resolution) : "";

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
          }, BACKGROUND_DEBOUNCE_DELAY);
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
        },
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
        data.results.forEach(function (card) { if (card.wide !== false) card.wide = false; });

        Lampa.Utils.extendItemsParams(data.results, {
          style: { name: Lampa.Storage.get("wide_post") !== false ? "wide" : "small" },
        });
      }
    }

    function handleCard(state, card) {
      if (!card || card.__newInterfaceCard) return;
      if (typeof card.use !== "function" || !card.data) return;

      card.__newInterfaceCard = true;
      card.params = card.params || {};
      card.params.style = card.params.style || {};

      var targetStyle = Lampa.Storage.get("wide_post") !== false ? "wide" : "small";
      card.params.style.name = targetStyle;

      if (card.render && typeof card.render === "function") {
        var element = card.render(true);
        if (element) {
          var node = element.jquery ? element[0] : element;
          if (node && node.classList) {
            if (targetStyle === "wide") { node.classList.add("card--wide"); node.classList.remove("card--small"); }
            else { node.classList.add("card--small"); node.classList.remove("card--wide"); }
          }
        }
      }

      card.use({
        onFocus: function () { state.update(card.data); },
        onHover: function () { state.update(card.data); },
        onTouch: function () { state.update(card.data); },
        onDestroy: function () { delete card.__newInterfaceCard; },
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

      line.items_per_row = 12;
      line.view = 12;
      if (line.params) {
        line.params.items_per_row = 12;
        if (line.params.items) line.params.items.view = 12;
      }

      var processCard = function (card) { handleCard(state, card); };

      line.use({
        onInstance: function (instance) { processCard(instance); },
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
        onDestroy: function () { state.reset(); delete line.__newInterfaceLine; },
      });

      if (Array.isArray(line.items) && line.items.length) line.items.forEach(processCard);

      if (line.last) {
        var lastCardData = findCardData(line.last);
        if (lastCardData) state.update(lastCardData);
      }
    }

    // -----------------------------
    // Settings integration
    // -----------------------------
    function initializeSettings() {
      Lampa.Settings.listener.follow("open", function () {
        // когда заходим в настройки — стопаем каталог
        stopCatalogAudioEverywhere({ destroy: false });
      });

      Lampa.SettingsApi.addComponent({ component: "style_interface", name: "Стильный интерфейс" });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "logo_show", type: "trigger", default: true },
        field: { name: "Показывать логотип вместо названия" },
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "show_background", type: "trigger", default: true },
        field: { name: "Отображать постеры на фоне" },
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "catalog_run_trailers", type: "trigger", default: true },
        field: { name: "Автотрейлер в каталоге (фон)" },
        onChange: function (v) { if (!v) stopCatalogAudioEverywhere({ destroy: false }); },
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "catalog_trailer_sound", type: "trigger", default: false },
        field: { name: "Звук трейлера в каталоге" },
        onChange: function () { stopCatalogAudioEverywhere({ destroy: false }); },
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "cardify_run_trailers", type: "trigger", default: true },
        field: { name: "Автотрейлер на странице фильма (Cardify)" },
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "cardify_trailer_sound", type: "trigger", default: true },
        field: { name: "Звук трейлера на странице фильма" },
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "background_resolution", type: "select", default: "original", values: { w300: "w300", w780: "w780", w1280: "w1280", original: "original" } },
        field: { name: "Разрешение фона" },
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "hide_captions", type: "trigger", default: true },
        field: { name: "Скрывать названия и год", description: "Лампа будет перезагружена" },
        onChange: function () { window.location.reload(); },
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "wide_post", type: "trigger", default: true },
        field: { name: "Широкие постеры", description: "Лампа будет перезагружена" },
        onChange: function () { window.location.reload(); },
      });
    }

    // -----------------------------
    // Global listeners to stop catalog audio on leaving catalog
    // -----------------------------
    function installGlobalStopListeners() {
      // 1) На full мы и так стопаем внутри hookFullAutoTrailer, но оставим страховку:
      Lampa.Listener.follow("full", function (e) {
        if (!e) return;
        if (e.type === "complite" || e.type === "complete") stopCatalogAudioEverywhere({ destroy: false });
      });

      // 2) toggle — НЕ стопаем бездумно, а проверяем “ушли ли из каталога”
      if (Lampa.Controller && Lampa.Controller.listener) {
        Lampa.Controller.listener.follow("toggle", function () {
          setTimeout(function () {
            if (!isCatalogVisibleNow()) stopCatalogAudioEverywhere({ destroy: false });
          }, 0);
        });
      }

      // 3) activity start/active — тоже проверяем контекст
      if (Lampa.Listener) {
        Lampa.Listener.follow("activity", function (e) {
          if (!e) return;
          if (e.type === "start" || e.type === "active") {
            setTimeout(function () {
              if (!isCatalogVisibleNow()) stopCatalogAudioEverywhere({ destroy: false });
            }, 0);
          }
        });
      }
    }

    // -----------------------------
    // Start everything
    // -----------------------------
    installCardifyTemplateAndCss();
    hookFullAutoTrailer();

    addStylesNewInterface();
    initializeSettings();
    installGlobalStopListeners();

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

        if (!data.params) data.params = {};
        if (!data.params.items) data.params.items = {};
        data.params.items.view = 12;
        data.params.items_per_row = 12;
        data.items_per_row = 12;

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
