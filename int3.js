(function () {
  "use strict";

  if (window.plugin_cardify_style_combo_v13) return;
  window.plugin_cardify_style_combo_v13 = true;

  // -----------------------------
  // Boot: ждём Lampa + appready
  // -----------------------------
  var bootTimer = setInterval(function () {
    if (window.Lampa && window["app" + "re" + "ady"]) {
      clearInterval(bootTimer);
      try {
        init();
      } catch (e) {
        console.log("[combo v1.3] init error", e);
      }
    }
  }, 200);

  function init() {
    if (!window.Lampa) return;

    // TV режим (как у тебя)
    try {
      Lampa.Platform.tv();
    } catch (e) {}

    if (!Lampa.Maker || !Lampa.Maker.map || !Lampa.Utils || !Lampa.Template) return;

    // -----------------------------
    // Helpers
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

    // Нормальное чтение настроек (SettingsApi чаще пишет в field)
    function S(key, def) {
      try {
        var v = Lampa.Storage.field(key);
        if (v === undefined) v = Lampa.Storage.get(key);
        return v === undefined ? def : v;
      } catch (e) {
        try {
          return Lampa.Storage.get(key, def);
        } catch (e2) {
          return def;
        }
      }
    }

    function ensureYT(cb) {
      if (window.YT && YT.Player) return cb();

      if (document.getElementById("combo_yt_api")) {
        var t = setInterval(function () {
          if (window.YT && YT.Player) {
            clearInterval(t);
            cb();
          }
        }, 200);
        return;
      }

      var tag = document.createElement("script");
      tag.id = "combo_yt_api";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);

      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        try {
          if (typeof prev === "function") prev();
        } catch (e) {}
        cb();
      };
    }

    function buildTmdbDetailUrl(data, append) {
      if (!data || !data.id) return "";
      if (!Lampa.TMDB || typeof Lampa.TMDB.api !== "function" || typeof Lampa.TMDB.key !== "function") return "";

      var source = data.source || "tmdb";
      if (source !== "tmdb" && source !== "cub") return "";

      var mediaType = data.media_type === "tv" || data.name ? "tv" : "movie";
      var language = S("tmdb_lang", null) || S("language", null) || "ru";

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

    // -----------------------------
    // Detail cache + dedupe
    // -----------------------------
    var detailCache = {};
    var pending = {}; // url -> callbacks[]

    function ensureDetails(data, append, cb) {
      var url = buildTmdbDetailUrl(data, append);
      if (!url) return cb(null);

      if (detailCache[url]) return cb(detailCache[url]);

      if (pending[url]) {
        pending[url].push(cb);
        return;
      }

      pending[url] = [cb];

      var req = new Lampa.Reguest();
      req.silent(
        url,
        function (resp) {
          detailCache[url] = resp;
          var list = pending[url] || [];
          delete pending[url];
          list.forEach(function (fn) {
            try {
              fn(resp);
            } catch (e) {}
          });
        },
        function () {
          var list2 = pending[url] || [];
          delete pending[url];
          list2.forEach(function (fn) {
            try {
              fn(null);
            } catch (e) {}
          });
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
          name: v.name || ""
        });
      });

      if (!items.length) return null;

      var lang = "";
      try {
        lang = S("tmdb_lang", null) || S("language", null) || "ru";
      } catch (e) {}

      items.sort(function (a, b) {
        var ap = a.type === "trailer" ? 2 : a.type === "teaser" ? 1 : 0;
        var bp = b.type === "trailer" ? 2 : b.type === "teaser" ? 1 : 0;
        if (ap !== bp) return bp - ap;
        if (a.time !== b.time) return b.time - a.time;
        return 0;
      });

      var my = items.filter(function (x) {
        return x.code === lang;
      });
      var en = items.filter(function (x) {
        return x.code === "en";
      });

      return my[0] || en[0] || items[0] || null;
    }

    // -----------------------------
    // GLOBAL STOP: каталожные трейлеры
    // -----------------------------
    var catalogTrailerPool = [];

    function stopAllCatalogTrailers(destroy) {
      for (var i = 0; i < catalogTrailerPool.length; i++) {
        try {
          catalogTrailerPool[i].stop(!!destroy);
        } catch (e) {}
      }
    }

    function registerCatalogTrailer(instance) {
      if (!instance) return;
      if (catalogTrailerPool.indexOf(instance) >= 0) return;
      catalogTrailerPool.push(instance);
    }

    function unregisterCatalogTrailer(instance) {
      var idx = catalogTrailerPool.indexOf(instance);
      if (idx >= 0) catalogTrailerPool.splice(idx, 1);
    }

    // Стопаем каталог корректно: по activity/settings/full (без DOM-watch, который убивал трейлеры)
    try {
      Lampa.Listener.follow("activity", function (e) {
        if (!e) return;

        if (e.type === "start" || e.type === "create") {
          var a = null;
          try {
            a = Lampa.Activity.active();
          } catch (err) {}

          // если мы ушли с главной (main) — глушим каталожные трейлеры
          if (a && a.component && a.component !== "main") stopAllCatalogTrailers(true);
        }

        if (e.type === "destroy") {
          stopAllCatalogTrailers(true);
        }
      });
    } catch (e) {}

    try {
      Lampa.Settings.listener.follow("open", function () {
        stopAllCatalogTrailers(true);
      });
    } catch (e) {}

    try {
      Lampa.Listener.follow("full", function (e) {
        if (!e) return;
        if (e.type === "start" || e.type === "complite" || e.type === "complete") stopAllCatalogTrailers(true);
      });
    } catch (e) {}

    // -----------------------------
    // 1) CARDIFY (FULL PAGE): template + css + bg trailer
    // -----------------------------
    function installCardifyTemplateAndCss() {
      // Template (как у тебя, минимализм не трогаем)
      Lampa.Template.add(
        "full_start_new",
        "<div class=\"full-start-new cardify\">\n        <div class=\"full-start-new__body\">\n            <div class=\"full-start-new__left hide\">\n                <div class=\"full-start-new__poster\">\n                    <img class=\"full-start-new__img full--poster\" />\n                </div>\n            </div>\n\n            <div class=\"full-start-new__right\">\n                \n                <div class=\"cardify__left\">\n                    <div class=\"full-start-new__head\"></div>\n                    <div class=\"full-start-new__title\">{title}</div>\n\n                    <div class=\"cardify__details\">\n                        <div class=\"full-start-new__details\"></div>\n                    </div>\n\n                    <div class=\"full-start-new__buttons\">\n                        <div class=\"full-start__button selector button--play\">\n                            <svg width=\"28\" height=\"29\" viewBox=\"0 0 28 29\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <circle cx=\"14\" cy=\"14.5\" r=\"13\" stroke=\"currentColor\" stroke-width=\"2.7\"/>\n                                <path d=\"M18.0739 13.634C18.7406 14.0189 18.7406 14.9811 18.0739 15.366L11.751 19.0166C11.0843 19.4015 10.251 18.9204 10.251 18.1506L10.251 10.8494C10.251 10.0796 11.0843 9.5985 11.751 9.9834L18.0739 13.634Z\" fill=\"currentColor\"/>\n                            </svg>\n\n                            <span>#{title_watch}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--book\">\n                            <svg width=\"21\" height=\"32\" viewBox=\"0 0 21 32\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                            <path d=\"M2 1.5H19C19.2761 1.5 19.5 1.72386 19.5 2V27.9618C19.5 28.3756 19.0261 28.6103 18.697 28.3595L12.6212 23.7303C11.3682 22.7757 9.63183 22.7757 8.37885 23.7303L2.30302 28.3595C1.9739 28.6103 1.5 28.3756 1.5 27.9618V2C1.5 1.72386 1.72386 1.5 2 1.5Z\" stroke=\"currentColor\" stroke-width=\"2.5\"/>\n                            </svg>\n\n                            <span>#{settings_input_links}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--reaction\">\n                            <svg width=\"38\" height=\"34\" viewBox=\"0 0 38 34\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <path d=\"M37.208 10.9742C37.1364 10.8013 37.0314 10.6441 36.899 10.5117C36.7666 10.3794 36.6095 10.2744 36.4365 10.2028L12.0658 0.108375C11.7166 -0.0361828 11.3242 -0.0361227 10.9749 0.108542C10.6257 0.253206 10.3482 0.530634 10.2034 0.879836L0.108666 25.2507C0.0369593 25.4236 3.37953e-05 25.609 2.3187e-08 25.7962C-3.37489e-05 25.9834 0.0368249 26.1688 0.108469 26.3418C0.180114 26.5147 0.28514 26.6719 0.417545 26.8042C0.54995 26.9366 0.707139 27.0416 0.880127 27.1131L17.2452 33.8917C17.5945 34.0361 17.9869 34.0361 18.3362 33.8917L29.6574 29.2017C29.8304 29.1301 29.9875 29.0251 30.1199 28.8928C30.2523 28.7604 30.3573 28.6032 30.4289 28.4303L37.2078 12.065C37.2795 11.8921 37.3164 11.7068 37.3164 11.5196C37.3165 11.3325 37.2796 11.1471 37.208 10.9742ZM20.425 29.9407L21.8784 26.4316L25.3873 27.885L20.425 29.9407ZM28.3407 26.0222L21.6524 23.252C21.3031 23.1075 20.9107 23.1076 20.5615 23.2523C20.2123 23.3969 19.9348 23.6743 19.79 24.0235L17.0194 30.7123L3.28783 25.0247L12.2918 3.28773L34.0286 12.2912L28.3407 26.0222Z\" fill=\"currentColor\"/>\n                                <path d=\"M25.3493 16.976L24.258 14.3423L16.959 17.3666L15.7196 14.375L13.0859 15.4659L15.4161 21.0916L25.3493 16.976Z\" fill=\"currentColor\"/>\n                            </svg>                \n\n                            <span>#{title_reactions}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--subscribe hide\">\n                            <svg width=\"25\" height=\"30\" viewBox=\"0 0 25 30\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                            <path d=\"M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7367 27 9.27804 25.6961 9.03542 24H6.01892Z\" fill=\"currentColor\"/>\n                            <path d=\"M3.81972 14.5957V10.2679C3.81972 5.41336 7.7181 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.2106 22.9392 23.5 20.9098 23.5H4.09021C2.06084 23.5 0.792282 21.2106 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z\" stroke=\"currentColor\" stroke-width=\"2.5\"/>\n                            </svg>\n\n                            <span>#{title_subscribe}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--options\">\n                            <svg width=\"38\" height=\"10\" viewBox=\"0 0 38 10\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <circle cx=\"4.88968\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                                <circle cx=\"18.9746\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                                <circle cx=\"33.0596\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                            </svg>\n                        </div>\n                    </div>\n                </div>\n\n                <div class=\"cardify__right\">\n                    <div class=\"full-start-new__reactions selector\">\n                        <div>#{reactions_none}</div>\n                    </div>\n\n                    <div class=\"full-start-new__rate-line\">\n                        <div class=\"full-start__pg hide\"></div>\n                        <div class=\"full-start__status hide\"></div>\n                    </div>\n                </div>\n            </div>\n        </div>\n\n        <div class=\"hide buttons--container\">\n            <div class=\"full-start__button view--torrent hide\">\n                <svg xmlns=\"http://www.w3.org/2000/svg\"  viewBox=\"0 0 50 50\" width=\"50px\" height=\"50px\">\n                    <path d=\"M25,2C12.317,2,2,12.317,2,25s10.317,23,23,23s23-10.317,23-23S37.683,2,25,2z M40.5,30.963c-3.1,0-4.9-2.4-4.9-2.4 S34.1,35,27,35c-1.4,0-3.6-0.837-3.6-0.837l4.17,9.643C26.727,43.92,25.874,44,25,44c-2.157,0-4.222-0.377-6.155-1.039L9.237,16.851 c0,0-0.7-1.2,0.4-1.5c1.1-0.3,5.4-1.2,5.4-1.2s1.475-0.494,1.8,0.5c0.5,1.3,4.063,11.112,4.063,11.112S22.6,29,27.4,29 c4.7,0,5.9-3.437,5.7-3.937c-1.2-3-4.993-11.862-4.993-11.862s-0.6-1.1,0.8-1.4c1.4-0.3,3.8-0.7,3.8-0.7s1.105-0.163,1.6,0.8 c0.738,1.437,5.193,11.262,5.193,11.262s1.1,2.9,3.3,2.9c0.464,0,0.834-0.046,1.152-0.104c-0.082,1.635-0.348,3.221-0.817,4.722 C42.541,30.867,41.756,30.963,40.5,30.963z\" fill=\"currentColor\"/>\n                </svg>\n\n                <span>#{full_torrents}</span>\n            </div>\n\n            <div class=\"full-start__button selector view--trailer\">\n                <svg height=\"70\" viewBox=\"0 0 80 70\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                    <path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M71.2555 2.08955C74.6975 3.2397 77.4083 6.62804 78.3283 10.9306C80 18.7291 80 35 80 35C80 35 80 51.2709 78.3283 59.0694C77.4083 63.372 74.6975 66.7603 71.2555 67.9104C65.0167 70 40 70 40 70C40 70 14.9833 70 8.74453 67.9104C5.3025 66.7603 2.59172 63.372 1.67172 59.0694C0 51.2709 0 35 0 35C0 35 0 18.7291 1.67172 10.9306C2.59172 6.62804 5.3025 3.2395 8.74453 2.08955C14.9833 0 40 0 40 0C40 0 65.0167 0 71.2555 2.08955ZM55.5909 35.0004L29.9773 49.5714V20.4286L55.5909 35.0004Z\" fill=\"currentColor\"></path>\n                </svg>\n\n                <span>#{full_trailers}</span>\n            </div>\n        </div>\n    </div>"
      );

      // CSS (как у тебя)
      Lampa.Template.add(
        "cardify_css",
        "\n        <style>\n        .cardify{-webkit-transition:all .3s;-o-transition:all .3s;-moz-transition:all .3s;transition:all .3s}.cardify .full-start-new__body{height:80vh}.cardify .full-start-new__right{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:end;-webkit-align-items:flex-end;-moz-box-align:end;-ms-flex-align:end;align-items:flex-end}.cardify .full-start-new__title{text-shadow:0 0 .1em rgba(0,0,0,0.3)}.cardify__left{-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1}.cardify__right{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;position:relative}.cardify__details{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}.cardify .full-start-new__reactions{margin:0;margin-right:-2.8em}.cardify .full-start-new__reactions:not(.focus){margin:0}.cardify .full-start-new__reactions:not(.focus)>div:not(:first-child){display:none}.cardify .full-start-new__reactions:not(.focus) .reaction{position:relative}.cardify .full-start-new__reactions:not(.focus) .reaction__count{position:absolute;top:28%;left:95%;font-size:1.2em;font-weight:500}.cardify .full-start-new__rate-line{margin:0;margin-left:3.5em}.cardify .full-start-new__rate-line>*:last-child{margin-right:0 !important}.cardify__background{left:0}.cardify__background.loaded:not(.dim){opacity:1}.cardify__background.nodisplay{opacity:0 !important}.cardify.nodisplay{-webkit-transform:translate3d(0,50%,0);-moz-transform:translate3d(0,50%,0);transform:translate3d(0,50%,0);opacity:0}.head.nodisplay{-webkit-transform:translate3d(0,-100%,0);-moz-transform:translate3d(0,-100%,0);transform:translate3d(0,-100%,0)}body:not(.menu--open) .cardify__background{-webkit-mask-image:-webkit-gradient(linear,left top,left bottom,color-stop(50%,white),to(rgba(255,255,255,0)));-webkit-mask-image:-webkit-linear-gradient(top,white 50%,rgba(255,255,255,0) 100%);mask-image:-webkit-gradient(linear,left top,left bottom,color-stop(50%,white),to(rgba(255,255,255,0)));mask-image:linear-gradient(to bottom,white 50%,rgba(255,255,255,0) 100%)}\n        </style>\n    "
      );
      $("body").append(Lampa.Template.get("cardify_css", {}, true));

      // Full-page bg trailer styles
      addOnceStyle(
        "combo_cardify_bgtrailer_css",
        ".cardify-bgtrailer{opacity:0;transition:opacity .25s;pointer-events:none;position:absolute;top:-60%;bottom:-60%;left:0;width:100%;display:flex;align-items:center;z-index:0}" +
          ".cardify-bgtrailer.display{opacity:1}" +
          ".cardify-bgtrailer iframe{border:0;width:100%;flex-shrink:0;display:block}" +
          ".cardify-bgtrailer__iframe{width:100%}" +
          ".full-start__background{overflow:hidden}" +
          ".full-start__background.cardify-bgtrailer--on{background-image:none!important}" +
          ".full-start__background.cardify-bgtrailer--on>img{opacity:0!important;transition:opacity .2s}"
      );
    }

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

      this.html = $(
        '<div class="cardify-bgtrailer">' +
          '<div class="cardify-bgtrailer__iframe"></div>' +
        "</div>"
      );

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
            showinfo: 0,
            autohide: 1,
            modestbranding: 1,
            autoplay: 0,
            disablekb: 1,
            fs: 0,
            enablejsapi: 1,
            playsinline: 1,
            rel: 0,
            iv_load_policy: 3
          },
          events: {
            onReady: function () {
              _this.loaded = true;
              try { _this.youtube.setPlaybackQuality("hd1080"); } catch (e) {}
              try {
                if (_this.opts.sound === false) _this.youtube.mute();
                else _this.youtube.unMute();
              } catch (e2) {}
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

              if (state.data === YT.PlayerState.BUFFERING) {
                try { state.target.setPlaybackQuality("hd1080"); } catch (e4) {}
              }
            },
            onError: function () {
              _this.setStaticHidden(false);
              _this.destroy();
            }
          }
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

    BgPlayer.prototype.play = function () {
      if (!this.loaded) return;
      try { this.youtube.playVideo(); } catch (e) {}
    };

    BgPlayer.prototype.pause = function () {
      if (!this.loaded) return;
      try { this.youtube.pauseVideo(); } catch (e) {}
    };

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
      this.video = video;
      this.opts = opts || {};

      this.player = new BgPlayer(object.activity, video, opts);

      this.timelauch = 1200;
      this.firstlauch = false;

      this.timerCheck = null;

      this.onToggle = function () { _this.update(); };
      this.onActivity = function (e) {
        if (e.type === "destroy" && e.object.activity === _this.object.activity) _this.destroy();
      };

      Lampa.Controller.listener.follow("toggle", this.onToggle);
      Lampa.Listener.follow("activity", this.onActivity);

      this.start();
    }

    BgTrailer.prototype.same = function () {
      try { return Lampa.Activity.active().activity === this.object.activity; }
      catch (e) { return false; }
    };

    BgTrailer.prototype.isTopView = function () {
      try {
        var name = Lampa.Controller.enabled().name;
        if (name && name !== "full_start") return false;
      } catch (e) {}

      try {
        var body = this.object.activity.render().find(".full-start-new__body").eq(0);
        if (body.length) {
          var top = body[0].getBoundingClientRect().top;
          if (top < -20) return false;
        }
      } catch (e2) {}

      return true;
    };

    BgTrailer.prototype.update = function () {
      if (!this.same()) { this.player.pause(); return; }
      if (!this.isTopView()) { this.player.pause(); return; }
      this.player.play();
    };

    BgTrailer.prototype.start = function () {
      var _this = this;

      clearInterval(this.timerCheck);
      this.timerCheck = setInterval(function () {
        _this.update();
      }, 250);

      clearTimeout(this.timerLoad);
      this.timerLoad = setTimeout(function () {
        if (_this.same() && _this.isTopView()) {
          _this.player.play();
          if (!_this.firstlauch) {
            _this.firstlauch = true;
            _this.timelauch = 5000;
          }
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
      Lampa.Listener.follow("full", function (e) {
        if (!e) return;
        if (!(e.type === "complite" || e.type === "complete")) return;

        if (!S("cardify_run_trailers", true)) return;
        if (!e.object || !e.object.activity) return;
        if (e.object.activity.trailer_ready) return;

        try {
          if (Lampa.Manifest && Lampa.Manifest.app_digital && Lampa.Manifest.app_digital < 220) return;
        } catch (err) {}

        try { e.object.activity.render().find(".full-start__background").addClass("cardify__background"); } catch (err2) {}

        var trailer = null;
        try { trailer = pickTrailerFromDetails(e.data); } catch (ex) {}

        function start(tr) {
          if (!tr) return;

          try {
            if (Lampa.Activity.active().activity === e.object.activity) {
              new BgTrailer(e.object, tr, { sound: S("cardify_trailer_sound", true) !== false });
            } else {
              var follow = function (a) {
                if (a.type === "start" && a.object.activity === e.object.activity && !e.object.activity.trailer_ready) {
                  Lampa.Listener.remove("activity", follow);
                  new BgTrailer(e.object, tr, { sound: S("cardify_trailer_sound", true) !== false });
                }
              };
              Lampa.Listener.follow("activity", follow);
            }
          } catch (e3) {}
        }

        if (!trailer) {
          ensureDetails(e.data, "videos", function (details) {
            start(pickTrailerFromDetails(details));
          });
          return;
        }

        start(trailer);
      });
    }

    // -----------------------------
    // 2) STYLE INTERFACE (CATALOG): bg + info + logo + trailer
    // -----------------------------
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

    function addStylesNewInterface() {
      if (addStylesNewInterface.added) return;
      addStylesNewInterface.added = true;

      var styles = S("wide_post", true) !== false ? getWideStyles() : getSmallStyles();

      Lampa.Template.add("combo_new_interface_style", styles);
      $("body").append(Lampa.Template.get("combo_new_interface_style", {}, true));

      // Слои: фон < трейлер < UI
      addOnceStyle(
        "combo_new_interface_layers",
        ".new-interface{position:relative;z-index:0}" +
          ".new-interface .full-start__background-wrapper{z-index:-2}" +
          ".new-interface .new-interface-trailer{position:absolute;top:-60%;bottom:-60%;left:0;width:100%;pointer-events:none;opacity:0;transition:opacity .25s;z-index:-1;display:flex;align-items:center}" +
          ".new-interface .new-interface-trailer.display{opacity:1}" +
          ".new-interface .new-interface-trailer > div{width:100%}" +
          ".new-interface .new-interface-trailer iframe{border:0;width:100%;flex-shrink:0;display:block}" +
          ".new-interface .full-start__background{transition:opacity .2s}" +
          ".new-interface.trailer-on .full-start__background{opacity:0!important}"
      );
    }

    function getWideStyles() {
      return (
        "<style>\n" +
        "  .items-line__title .full-person__photo { width: 1.8em !important; height: 1.8em !important; }\n" +
        "  .items-line__title .full-person--svg .full-person__photo { padding: 0.5em !important; margin-right: 0.5em !important; }\n" +
        "  .items-line__title .full-person__photo { margin-right: 0.5em !important; }\n" +
        "  .items-line { padding-bottom: 4em !important; }\n" +
        "  .new-interface-info__head, .new-interface-info__details{ opacity: 0; transition: opacity 0.5s ease; min-height: 2.2em !important;}\n" +
        "  .new-interface-info__head.visible, .new-interface-info__details.visible{ opacity: 1; }\n" +
        "  .new-interface .card.card--wide { width: 18.3em; }\n" +
        "  .new-interface .card.card--small { width: 18.3em; }\n" +
        "  .new-interface-info { position: relative; padding: 1.5em; height: 27.5em; }\n" +
        "  .new-interface-info__body { position: absolute; z-index: 5; width: 80%; padding-top: 1.1em; }\n" +
        "  .new-interface-info__head { color: rgba(255, 255, 255, 0.6); font-size: 1.3em; min-height: 1em; }\n" +
        "  .new-interface-info__head span { color: #fff; }\n" +
        "  .new-interface-info__title { font-size: 4em; font-weight: 600; margin-bottom: 0.3em; overflow: hidden; text-overflow: '.'; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; margin-left: -0.03em; line-height: 1.3; }\n" +
        "  .new-interface-info__details { margin-top: 1.2em; margin-bottom: 1.6em; display: flex; align-items: center; flex-wrap: wrap; min-height: 1.9em; font-size: 1.3em; }\n" +
        "  .new-interface-info__split { margin: 0 1em; font-size: 0.7em; }\n" +
        "  .new-interface-info__description { font-size: 1.4em; font-weight: 310; line-height: 1.3; overflow: hidden; text-overflow: '.'; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; width: 65%; }\n" +
        "  .new-interface .card-more__box { padding-bottom: 95%; }\n" +
        "  .new-interface .full-start__background-wrapper { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }\n" +
        "  .new-interface .full-start__background { position: absolute; height: 108%; width: 100%; top: -5em; left: 0; opacity: 0; object-fit: cover; transition: opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1); }\n" +
        "  .new-interface .full-start__background.active { opacity: 0.5; }\n" +
        "  .new-interface .full-start__rate { font-size: 1.3em; margin-right: 0; }\n" +
        "  .new-interface .card__promo { display: none; }\n" +
        "  .new-interface .card.card--wide + .card-more .card-more__box { padding-bottom: 95%; }\n" +
        "  .new-interface .card.card--wide .card-watched { display: none !important; }\n" +
        "  body.light--version .new-interface-info__body { width: 69%; padding-top: 1.5em; }\n" +
        "  body.light--version .new-interface-info { height: 25.3em; }\n" +
        "  body.advanced--animation:not(.no--animation) .new-interface .card.card--wide.focus .card__view { animation: animation-card-focus 0.2s; }\n" +
        "  body.advanced--animation:not(.no--animation) .new-interface .card.card--wide.animate-trigger-enter .card__view { animation: animation-trigger-enter 0.2s forwards; }\n" +
        "  body.advanced--animation:not(.no--animation) .new-interface .card.card--small.focus .card__view { animation: animation-card-focus 0.2s; }\n" +
        "  body.advanced--animation:not(.no--animation) .new-interface .card.card--small.animate-trigger-enter .card__view { animation: animation-trigger-enter 0.2s forwards; }\n" +
        "  .logo-moved-head { transition: opacity 0.4s ease; }\n" +
        "  .logo-moved-separator { transition: opacity 0.4s ease; }\n" +
        (S("hide_captions", true)
          ? "  .card:not(.card--collection) .card__age, .card:not(.card--collection) .card__title { display: none !important; }\n"
          : "") +
        "</style>"
      );
    }

    function getSmallStyles() {
      return (
        "<style>\n" +
        "  .new-interface-info__head, .new-interface-info__details{ opacity: 0; transition: opacity 0.5s ease; min-height: 2.2em !important;}\n" +
        "  .new-interface-info__head.visible, .new-interface-info__details.visible{ opacity: 1; }\n" +
        "  .new-interface .card.card--wide{ width: 18.3em; }\n" +
        "  .items-line__title .full-person__photo { width: 1.8em !important; height: 1.8em !important; }\n" +
        "  .items-line__title .full-person--svg .full-person__photo { padding: 0.5em !important; margin-right: 0.5em !important; }\n" +
        "  .items-line__title .full-person__photo { margin-right: 0.5em !important; }\n" +
        "  .new-interface-info { position: relative; padding: 1.5em; height: 19.8em; }\n" +
        "  .new-interface-info__body { position: absolute; z-index: 5; width: 80%; padding-top: 0.2em; }\n" +
        "  .new-interface-info__head { color: rgba(255, 255, 255, 0.6); margin-bottom: 0.3em; font-size: 1.2em; min-height: 1em; }\n" +
        "  .new-interface-info__head span { color: #fff; }\n" +
        "  .new-interface-info__title { font-size: 3em; font-weight: 600; margin-bottom: 0.2em; overflow: hidden; text-overflow: '.'; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; margin-left: -0.03em; line-height: 1.3; }\n" +
        "  .new-interface-info__details { margin-top: 1.2em; margin-bottom: 1.6em; display: flex; align-items: center; flex-wrap: wrap; min-height: 1.9em; font-size: 1.2em; }\n" +
        "  .new-interface-info__split { margin: 0 1em; font-size: 0.7em; }\n" +
        "  .new-interface-info__description { font-size: 1.3em; font-weight: 310; line-height: 1.3; overflow: hidden; text-overflow: '.'; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; width: 70%; }\n" +
        "  .new-interface .card-more__box { padding-bottom: 150%; }\n" +
        "  .new-interface .full-start__background-wrapper { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }\n" +
        "  .new-interface .full-start__background { position: absolute; height: 108%; width: 100%; top: -5em; left: 0; opacity: 0; object-fit: cover; transition: opacity 0.8s cubic-bezier(0.4, 0, 0.2, 1); }\n" +
        "  .new-interface .full-start__background.active { opacity: 0.5; }\n" +
        "  .new-interface .full-start__rate { font-size: 1.2em; margin-right: 0; }\n" +
        "  .new-interface .card__promo { display: none; }\n" +
        "  .new-interface .card.card--wide + .card-more .card-more__box { padding-bottom: 95%; }\n" +
        "  .new-interface .card.card--wide .card-watched { display: none !important; }\n" +
        "  body.light--version .new-interface-info__body { width: 69%; padding-top: 1.5em; }\n" +
        "  body.light--version .new-interface-info { height: 25.3em; }\n" +
        "  body.advanced--animation:not(.no--animation) .new-interface .card.card--wide.focus .card__view { animation: animation-card-focus 0.2s; }\n" +
        "  body.advanced--animation:not(.no--animation) .new-interface .card.card--wide.animate-trigger-enter .card__view { animation: animation-trigger-enter 0.2s forwards; }\n" +
        "  body.advanced--animation:not(.no--animation) .new-interface .card.card--small.focus .card__view { animation: animation-card-focus 0.2s; }\n" +
        "  body.advanced--animation:not(.no--animation) .new-interface .card.card--small.animate-trigger-enter .card__view { animation: animation-trigger-enter 0.2s forwards; }\n" +
        "  .logo-moved-head { transition: opacity 0.4s ease; }\n" +
        "  .logo-moved-separator { transition: opacity 0.4s ease; }\n" +
        (S("hide_captions", true)
          ? "  .card:not(.card--collection) .card__age, .card:not(.card--collection) .card__title { display: none !important; }\n"
          : "") +
        "</style>"
      );
    }

    // -----------------------------
    // Catalog trailer layer
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
    }

    CatalogTrailer.prototype.enabled = function () {
      return S("catalog_run_trailers", true) !== false;
    };

    CatalogTrailer.prototype.soundWanted = function () {
      return S("catalog_trailer_sound", false) === true;
    };

    CatalogTrailer.prototype.attach = function (container, afterNode) {
      if (this.wrapper) return;

      this.wrapper = document.createElement("div");
      this.wrapper.className = "new-interface-trailer";

      this.host = document.createElement("div");
      this.wrapper.appendChild(this.host);

      // ВАЖНО: вставляем СРАЗУ после backgroundWrapper
      if (afterNode && afterNode.parentNode === container) {
        container.insertBefore(this.wrapper, afterNode.nextSibling);
      } else {
        container.insertBefore(this.wrapper, container.firstChild || null);
      }

      registerCatalogTrailer(this);
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

    CatalogTrailer.prototype.stop = function (destroy) {
      clearTimeout(this.timer);
      this.token++;
      this._setUiState(false);

      try {
        if (this.player) {
          // stopVideo надежнее, чем pauseVideo (убирает залипший звук)
          try { this.player.stopVideo(); } catch (e1) {}
          try { this.player.mute(); } catch (e2) {}
          if (destroy) {
            try { this.player.destroy(); } catch (e3) {}
            this.player = null;
            this.loaded = false;
            this.currentVideo = "";
          }
        }
      } catch (e) {}
    };

    CatalogTrailer.prototype.destroy = function () {
      this.stop(true);
      try {
        if (this.wrapper && this.wrapper.parentNode) this.wrapper.parentNode.removeChild(this.wrapper);
      } catch (e) {}
      this.wrapper = null;
      this.host = null;
      unregisterCatalogTrailer(this);
    };

    CatalogTrailer.prototype.playFor = function (cardData) {
      var self = this;

      // играть только на главной
      try {
        var a = Lampa.Activity.active();
        if (!a || a.component !== "main") return this.stop(true);
      } catch (e) {
        return this.stop(true);
      }

      if (!this.enabled()) return this.stop(false);
      if (!cardData || !cardData.id) return this.stop(false);

      var myToken = ++this.token;
      clearTimeout(this.timer);

      // дебаунс при скролле
      this.timer = setTimeout(function () {
        if (self.token !== myToken) return;

        ensureDetails(cardData, "videos", function (details) {
          if (self.token !== myToken) return;

          var trailer = pickTrailerFromDetails(details);
          if (!trailer) return self.stop(false);

          ensureYT(function () {
            if (self.token !== myToken) return;

            function startMutedThenMaybeUnmute() {
              try {
                if (!self.player) return;
                // Всегда стартуем muted — так автоплей почти всегда разрешен на ТВ/webview
                try { self.player.mute(); } catch (e1) {}
                // Если пользователь включил звук — попробуем снять mute уже после старта
                if (self.soundWanted()) {
                  setTimeout(function () {
                    try { self.player.unMute(); } catch (e2) {}
                  }, 700);
                }
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
                  iv_load_policy: 3
                },
                events: {
                  onReady: function () {
                    if (self.token !== myToken) return;
                    self.loaded = true;
                    self.currentVideo = trailer.id;

                    try { self.player.setPlaybackQuality("hd1080"); } catch (e) {}
                    startMutedThenMaybeUnmute();

                    try { self.player.playVideo(); } catch (e2) {}
                  },
                  onStateChange: function (st) {
                    if (self.token !== myToken) return;

                    if (st.data === YT.PlayerState.PLAYING) self._setUiState(true);
                    if (st.data === YT.PlayerState.PAUSED) self._setUiState(false);

                    if (st.data === YT.PlayerState.ENDED) {
                      try { self.player.seekTo(0, true); self.player.playVideo(); } catch (e3) {}
                    }
                  },
                  onError: function () {
                    self.stop(false);
                  }
                }
              });
              return;
            }

            // уже есть player
            startMutedThenMaybeUnmute();

            if (self.currentVideo !== trailer.id) {
              self.currentVideo = trailer.id;
              try {
                self.player.loadVideoById(trailer.id);
              } catch (e4) {
                // fallback: пересоздать
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
      }, 900);
    };

    // -----------------------------
    // Info panel + logo (починил каталог)
    // -----------------------------
    function InfoPanel() {
      this.html = null;
      this.timer = null;
      this.fadeTimer = null;
      this.network = new Lampa.Reguest();
      this.loaded = detailCache;
      this.currentUrl = null;
      this.lastRenderId = 0;
    }

    InfoPanel.prototype.create = function () {
      this.html = $(
        '<div class="new-interface-info">' +
          '<div class="new-interface-info__body">' +
            '<div class="new-interface-info__head"></div>' +
            '<div class="new-interface-info__title"></div>' +
            '<div class="new-interface-info__details"></div>' +
            '<div class="new-interface-info__description"></div>' +
          "</div>" +
        "</div>"
      );
    };

    InfoPanel.prototype.render = function (asElement) {
      if (!this.html) this.create();
      return asElement ? this.html[0] : this.html;
    };

    InfoPanel.prototype.update = function (data) {
      if (!data || !this.html) return;

      this.lastRenderId = Date.now();
      var currentRenderId = this.lastRenderId;

      // ВАЖНО: чистим хвосты от прошлого лого, иначе в каталоге "не заменяется/не двигается"
      try {
        this.html.find(".logo-moved-head,.logo-moved-separator").remove();
        this.html.find(".new-interface-info__head").css({ opacity: "" });
      } catch (e0) {}

      this.html.find(".new-interface-info__head,.new-interface-info__details").removeClass("visible");

      var title = this.html.find(".new-interface-info__title");
      var desc = this.html.find(".new-interface-info__description");

      desc.text(data.overview || Lampa.Lang.translate("full_notext"));

      clearTimeout(this.fadeTimer);

      title.text(data.title || data.name || "");
      title.css({ opacity: 1 });

      this.load(data);

      if (S("logo_show", true)) {
        try { this.showLogo(data, currentRenderId); } catch (e2) {}
      }
    };

    // showLogo — твоя логика (оставил, но будет работать и в каталоге из-за очистки выше)
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

        // удаляем остатки на всякий случай
        try { details_elem.find(".logo-moved-head,.logo-moved-separator").remove(); } catch (e) {}

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
          head_elem.css({
            transition: "opacity " + FADE_OUT_TEXT / 1000 + "s ease",
            opacity: "0"
          });

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

          if (dom_title) {
            dom_title.style.display = "block";
            dom_title.style.height = "";
            dom_title.style.transition = "none";
          }
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

            title_elem.css({
              transition: "opacity " + FADE_OUT_TEXT / 1000 + "s ease",
              opacity: "0"
            });

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

              dom_title.style.transition =
                "height " + MORPH_HEIGHT / 1000 + "s cubic-bezier(0.4, 0, 0.2, 1)";

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

        img.onerror = function () {
          title_elem.css({ opacity: "1", transition: "none" });
        };
      }

      if (!data.id) return;

      var type = data.name ? "tv" : "movie";
      var language = S("language", "ru");
      var cache_key = "logo_cache_v2_" + type + "_" + data.id + "_" + language;
      var cached_url = S(cache_key, null);

      if (cached_url && cached_url !== "none") {
        var img_cache = new Image();
        img_cache.src = cached_url;

        if (img_cache.complete || S("async_load", true)) {
          startLogoAnimation(cached_url, true);
        } else {
          startLogoAnimation(cached_url, false);
        }
      } else {
        var url =
          Lampa.TMDB.api(
            type +
              "/" +
              data.id +
              "/images?api_key=" +
              Lampa.TMDB.key() +
              "&include_image_language=" +
              language +
              ",en,null"
          );

        $.get(url, function (data_api) {
          if (renderId && renderId !== _this.lastRenderId) return;

          var final_logo = null;
          if (data_api.logos && data_api.logos.length > 0) {
            for (var i = 0; i < data_api.logos.length; i++) {
              if (data_api.logos[i].iso_639_1 == language) {
                final_logo = data_api.logos[i].file_path;
                break;
              }
            }
            if (!final_logo) {
              for (var j = 0; j < data_api.logos.length; j++) {
                if (data_api.logos[j].iso_639_1 == "en") {
                  final_logo = data_api.logos[j].file_path;
                  break;
                }
              }
            }
            if (!final_logo) final_logo = data_api.logos[0].file_path;
          }

          if (final_logo) {
            var img_url = Lampa.TMDB.image("/t/p/original" + final_logo.replace(".svg", ".png"));
            try { Lampa.Storage.set(cache_key, img_url); } catch (e) {}
            startLogoAnimation(img_url, false);
          } else {
            try { Lampa.Storage.set(cache_key, "none"); } catch (e2) {}
          }
        }).fail(function () {});
      }
    };

    InfoPanel.prototype.load = function (data) {
      if (!data || !data.id) return;

      var source = data.source || "tmdb";
      if (source !== "tmdb" && source !== "cub") return;

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
      }, 300);
    };

    InfoPanel.prototype.draw = function (data) {
      if (!data || !this.html) return;

      if (data.overview) this.html.find(".new-interface-info__description").text(data.overview);

      var year = ((data.release_date || data.first_air_date || "0000") + "").slice(0, 4);
      var rating = parseFloat((data.vote_average || 0) + "").toFixed(1);

      var headInfo = [];
      var detailsInfo = [];

      var countries = [];
      try { countries = Lampa.Api.sources.tmdb.parseCountries(data) || []; } catch (e) {}
      if (countries.length > 2) countries = countries.slice(0, 2);

      var ageRating = "";
      try { ageRating = Lampa.Api.sources.tmdb.parsePG(data) || ""; } catch (e2) {}

      if (S("rat", true) !== false) {
        if (rating > 0) {
          var rate_style = "";
          if (S("colored_ratings", true)) {
            var vote_num = parseFloat(rating);
            var color = "";
            if (vote_num >= 0 && vote_num <= 3) color = "red";
            else if (vote_num > 3 && vote_num < 6) color = "orange";
            else if (vote_num >= 6 && vote_num < 7) color = "cornflowerblue";
            else if (vote_num >= 7 && vote_num < 8) color = "darkmagenta";
            else if (vote_num >= 8 && vote_num <= 10) color = "lawngreen";
            if (color) rate_style = ' style="color: ' + color + '"';
          }
          detailsInfo.push('<div class="full-start__rate"' + rate_style + "><div>" + rating + "</div><div>TMDB</div></div>");
        }
      }

      if (S("ganr", true) !== false) {
        if (data.genres && data.genres.length > 0) {
          detailsInfo.push(
            data.genres.slice(0, 2).map(function (g) { return Lampa.Utils.capitalizeFirstLetter(g.name); }).join(" | ")
          );
        }
      }

      if (S("vremya", true) !== false) {
        if (data.runtime) detailsInfo.push(Lampa.Utils.secondsToTime(data.runtime * 60, true));
      }

      if (S("seas", false) && data.number_of_seasons) {
        detailsInfo.push('<span class="full-start__pg" style="font-size: 0.9em;">Сезонов ' + data.number_of_seasons + "</span>");
      }
      if (S("eps", false) && data.number_of_episodes) {
        detailsInfo.push('<span class="full-start__pg" style="font-size: 0.9em;">Эпизодов ' + data.number_of_episodes + "</span>");
      }
      if (S("year_ogr", true) !== false) {
        if (ageRating) detailsInfo.push('<span class="full-start__pg" style="font-size: 0.9em;">' + ageRating + "</span>");
      }

      if (S("status", true) !== false && data.status) {
        var st = (data.status + "").toLowerCase();
        var statusText = data.status;
        if (st === "released") statusText = "Выпущенный";
        else if (st === "ended") statusText = "Закончен";
        else if (st === "returning series") statusText = "Онгоинг";
        else if (st === "canceled") statusText = "Отменено";
        else if (st === "post production") statusText = "Скоро";
        else if (st === "planned") statusText = "Запланировано";
        else if (st === "in production") statusText = "В производстве";

        detailsInfo.push('<span class="full-start__status" style="font-size: 0.9em;">' + statusText + "</span>");
      }

      var yc = [];
      if (year !== "0000") yc.push("<span>" + year + "</span>");
      if (countries.length > 0) yc.push(countries.join(", "));
      if (yc.length > 0) detailsInfo.push(yc.join(", "));

      this.html.find(".new-interface-info__head").empty().append(headInfo.join(", ")).toggleClass("visible", headInfo.length > 0);
      this.html.find(".new-interface-info__details").html(detailsInfo.join('<span class="new-interface-info__split">&#9679;</span>')).addClass("visible");
    };

    InfoPanel.prototype.empty = function () {
      if (!this.html) return;
      this.html.find(".new-interface-info__head,.new-interface-info__details").text("").removeClass("visible");
      try { this.html.find(".logo-moved-head,.logo-moved-separator").remove(); } catch (e) {}
    };

    InfoPanel.prototype.destroy = function () {
      clearTimeout(this.fadeTimer);
      clearTimeout(this.timer);
      this.network.clear();
      this.currentUrl = null;
      if (this.html) {
        this.html.remove();
        this.html = null;
      }
    };

    // -----------------------------
    // State: background + info + trailer
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

      var catalogTrailer = new CatalogTrailer({ main: mainInstance });

      var state = {
        main: mainInstance,
        info: infoPanel,
        background: backgroundWrapper,
        infoElement: null,
        backgroundTimer: null,
        backgroundLast: "",
        attached: false,

        attach: function () {
          if (this.attached) return;

          var container = mainInstance.render(true);
          if (!container) return;

          container.classList.add("new-interface");

          if (!backgroundWrapper.parentElement) {
            container.insertBefore(backgroundWrapper, container.firstChild || null);
          }

          // трейлер слой строго после backgroundWrapper
          catalogTrailer.attach(container, backgroundWrapper);

          var infoElement = infoPanel.render(true);
          this.infoElement = infoElement;

          if (infoElement && infoElement.parentNode !== container) {
            container.insertBefore(infoElement, backgroundWrapper.nextSibling ? backgroundWrapper.nextSibling.nextSibling : container.firstChild || null);
            // проще: гарантированно поверх (info имеет z-index:5), DOM-позиция уже не так критична
            if (infoElement.parentNode !== container) container.appendChild(infoElement);
          }

          try { mainInstance.scroll.minus(infoElement); } catch (e) {}
          this.attached = true;
        },

        update: function (data) {
          if (!data) return;
          infoPanel.update(data);
          this.updateBackground(data);

          if (S("catalog_run_trailers", true) !== false) catalogTrailer.playFor(data);
          else catalogTrailer.stop(false);
        },

        updateBackground: function (data) {
          var BACKGROUND_DEBOUNCE_DELAY = 300;
          var self = this;

          clearTimeout(this.backgroundTimer);

          var show_bg = S("show_background", true);
          var bg_resolution = S("background_resolution", "original");
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
          catalogTrailer.stop(false);
        },

        destroy: function () {
          clearTimeout(this.backgroundTimer);
          infoPanel.destroy();
          catalogTrailer.destroy();

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

      catalogTrailer.state = state;
      return state;
    }

    function getOrCreateState(createInstance) {
      if (createInstance.__comboState) return createInstance.__comboState;
      var s = createState(createInstance);
      createInstance.__comboState = s;
      return s;
    }

    function extendResultsWithStyle(data) {
      if (!data) return;

      if (Array.isArray(data.results)) {
        data.results.forEach(function (card) {
          if (card.wide !== false) card.wide = false;
        });

        Lampa.Utils.extendItemsParams(data.results, {
          style: { name: S("wide_post", true) !== false ? "wide" : "small" }
        });
      }
    }

    function handleCard(state, card) {
      if (!card || card.__comboCard) return;
      if (typeof card.use !== "function" || !card.data) return;

      card.__comboCard = true;
      card.params = card.params || {};
      card.params.style = card.params.style || {};

      var targetStyle = S("wide_post", true) !== false ? "wide" : "small";
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
        onDestroy: function () { delete card.__comboCard; }
      });
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

    function handleLineAppend(items, line) {
      if (line.__comboLine) return;
      line.__comboLine = true;

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
          var cd = (card && card.data) || (results && results.results && (results.results[0] || null));
          if (cd) state.update(cd);
        },
        onToggle: function () {
          setTimeout(function () {
            var focused = getFocusedCard(line);
            if (focused) state.update(focused);
          }, 32);
        },
        onMore: function () { state.reset(); },
        onDestroy: function () {
          state.reset();
          delete line.__comboLine;
        }
      });

      if (Array.isArray(line.items) && line.items.length) line.items.forEach(processCard);
    }

    // -----------------------------
    // Settings
    // -----------------------------
    function initializeSettings() {
      Lampa.Settings.listener.follow("open", function (event) {
        if (event.name == "main") {
          if (Lampa.Settings.main().render().find('[data-component="style_interface"]').length == 0) {
            Lampa.SettingsApi.addComponent({ component: "style_interface", name: "Стильный интерфейс" });
          }
          Lampa.Settings.main().update();
          Lampa.Settings.main().render().find('[data-component="style_interface"]').addClass("hide");
        }
      });

      Lampa.SettingsApi.addParam({
        component: "interface",
        param: { name: "style_interface", type: "static", default: true },
        field: { name: "Стильный интерфейс", description: "Настройки элементов" },
        onRender: function (item) {
          item.css("opacity", "0");
          requestAnimationFrame(function () {
            item.insertAfter($('div[data-name="interface_size"]'));
            item.css("opacity", "");
          });

          item.on("hover:enter", function () {
            Lampa.Settings.create("style_interface");
            Lampa.Controller.enabled().controller.back = function () {
              Lampa.Settings.create("interface");
            };
          });
        }
      });

      Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "logo_show", type: "trigger", default: true }, field: { name: "Показывать логотип вместо названия" } });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "show_background", type: "trigger", default: true },
        field: { name: "Отображать постеры на фоне" },
        onChange: function (value) { if (!value) $(".full-start__background").removeClass("active"); }
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "catalog_run_trailers", type: "trigger", default: true },
        field: { name: "Автотрейлер в каталоге (фон)", description: "YouTube-трейлер на фоне при фокусе" }
      });
      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "catalog_trailer_sound", type: "trigger", default: false },
        field: { name: "Звук трейлера в каталоге", description: "По умолчанию лучше выключить" }
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "cardify_run_trailers", type: "trigger", default: true },
        field: { name: "Автотрейлер на странице фильма (Cardify)" }
      });
      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "cardify_trailer_sound", type: "trigger", default: true },
        field: { name: "Звук трейлера на странице фильма" }
      });

      Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "status", type: "trigger", default: true }, field: { name: "Показывать статус фильма/сериала" } });
      Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "seas", type: "trigger", default: false }, field: { name: "Показывать количество сезонов" } });
      Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "eps", type: "trigger", default: false }, field: { name: "Показывать количество эпизодов" } });
      Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "year_ogr", type: "trigger", default: true }, field: { name: "Показывать возрастное ограничение" } });
      Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "vremya", type: "trigger", default: true }, field: { name: "Показывать время фильма" } });
      Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "ganr", type: "trigger", default: true }, field: { name: "Показывать жанр фильма" } });
      Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "rat", type: "trigger", default: true }, field: { name: "Показывать рейтинг фильма" } });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "background_resolution", type: "select", default: "original", values: { w300: "w300", w780: "w780", w1280: "w1280", original: "original" } },
        field: { name: "Разрешение фона", description: "Качество загружаемых фоновых изображений" }
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "hide_captions", type: "trigger", default: true },
        field: { name: "Скрывать названия и год", description: "Лампа будет перезагружена" },
        onChange: function () { window.location.reload(); }
      });

      Lampa.SettingsApi.addParam({
        component: "style_interface",
        param: { name: "wide_post", type: "trigger", default: true },
        field: { name: "Широкие постеры", description: "Лампа будет перезагружена" },
        onChange: function () { window.location.reload(); }
      });
    }

    // -----------------------------
    // RUN
    // -----------------------------
    installCardifyTemplateAndCss();
    hookFullAutoTrailer();
    addStylesNewInterface();
    initializeSettings();

    // Main hook
    var mainMaker = Lampa.Maker.map("Main");
    if (!mainMaker || !mainMaker.Items || !mainMaker.Create) return;

    wrapMethod(mainMaker.Items, "onInit", function (originalMethod, args) {
      this.__comboEnabled = shouldEnableInterface(this && this.object);

      if (this.__comboEnabled) {
        if (this.object) this.object.wide = false;
        this.wide = false;
      }

      if (originalMethod) originalMethod.apply(this, args);
    });

    wrapMethod(mainMaker.Create, "onCreate", function (originalMethod, args) {
      if (originalMethod) originalMethod.apply(this, args);
      if (!this.__comboEnabled) return;

      var state = getOrCreateState(this);
      state.attach();
    });

    wrapMethod(mainMaker.Create, "onCreateAndAppend", function (originalMethod, args) {
      var data = args && args[0];
      if (this.__comboEnabled && data) {
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
      if (!this.__comboEnabled) return;

      var element = args && args[0];
      if (element) handleLineAppend(this, element);
    });

    wrapMethod(mainMaker.Items, "onDestroy", function (originalMethod, args) {
      if (this.__comboState) {
        this.__comboState.destroy();
        delete this.__comboState;
      }
      delete this.__comboEnabled;

      stopAllCatalogTrailers(true);

      if (originalMethod) originalMethod.apply(this, args);
    });
  }
})();
