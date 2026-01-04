(function () {
  'use strict';

  if (!window.Lampa) return;

  // -----------------------------
  // Helpers
  // -----------------------------
  function isTV() {
    try { return Lampa.Platform && Lampa.Platform.screen && Lampa.Platform.screen('tv'); }
    catch (e) { return true; }
  }

  function addOnceStyle(id, cssText) {
    try {
      if (document.getElementById(id)) return;
      var st = document.createElement('style');
      st.id = id;
      st.textContent = cssText;
      document.body.appendChild(st);
    } catch (e) {}
  }

  function ensureYT(cb) {
    if (window.YT && YT.Player) return cb();

    if (document.getElementById('cardify_yt_api')) {
      // API уже грузится — дождёмся готовности
      var t = setInterval(function () {
        if (window.YT && YT.Player) {
          clearInterval(t);
          cb();
        }
      }, 200);
      return;
    }

    var tag = document.createElement('script');
    tag.id = 'cardify_yt_api';
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      try { if (typeof prev === 'function') prev(); } catch (e) {}
      cb();
    };
  }

  // -----------------------------
  // Trailer selection (как в оригинале)
  // -----------------------------
  function pickTrailer(data) {
    if (data && data.videos && data.videos.results && data.videos.results.length) {
      var items = [];
      data.videos.results.forEach(function (element) {
        if (!element || !element.key) return;
        items.push({
          title: Lampa.Utils.shortText(element.name || '', 50),
          id: element.key,
          code: element.iso_639_1,
          time: element.published_at ? new Date(element.published_at).getTime() : 0,
          url: 'https://www.youtube.com/watch?v=' + element.key,
          img: 'https://img.youtube.com/vi/' + element.key + '/default.jpg'
        });
      });

      items.sort(function (a, b) {
        return a.time > b.time ? -1 : a.time < b.time ? 1 : 0;
      });

      var my = [];
      var en = [];
      try {
        var lang = Lampa.Storage.field('tmdb_lang');
        my = items.filter(function (n) { return n.code == lang; });
        en = items.filter(function (n) { return n.code == 'en' && my.indexOf(n) == -1; });
      } catch (e) {}

      var out = [];
      if (my.length) out = out.concat(my);
      out = out.concat(en);
      if (!out.length) out = items;

      return out[0] || null;
    }
    return null;
  }

  // -----------------------------
  // Background YT Player
  // -----------------------------
  function BgPlayer(activity, video) {
    var _this = this;

    this.activity = activity;
    this.video = video;
    this.loaded = false;
    this.playing = false;
    this.destroyed = false;

    this.background = this.activity.render().find('.full-start__background');

    // DOM
    this.html = $(
      '<div class="cardify-bgvideo">' +
        '<div class="cardify-bgvideo__iframe"></div>' +
        '<div class="cardify-bgvideo__shade"></div>' +
        '<div class="cardify-bgvideo__hint"><span>' + (Lampa.Lang ? Lampa.Lang.translate('cardify_enable_sound') : 'Enable sound') + ' (OK)</span></div>' +
      '</div>'
    );

    this.iframeHost = this.html.find('.cardify-bgvideo__iframe');
    this.hint = this.html.find('.cardify-bgvideo__hint');

    // ВАЖНО: вставляем именно В ФОН, а не fixed поверх всего
    this.background.append(this.html);

    // Keydown для unmute по OK/Enter (если автозвук заблокирован)
    this.onKeyDown = function (e) {
      if (_this.destroyed) return;
      if (!_this.isActive()) return;

      // Enter / OK (часто 13)
      if (e.keyCode === 13 || e.key === 'Enter') {
        _this.unmute(true);
      }
    };

    ensureYT(function () {
      if (_this.destroyed) return;
      _this.create();
    });
  }

  BgPlayer.prototype.isActive = function () {
    try {
      return Lampa.Activity.active().activity === this.activity &&
        Lampa.Controller.enabled().name === 'full_start';
    } catch (e) { return false; }
  };

  BgPlayer.prototype.create = function () {
    var _this = this;

    if (!(window.YT && YT.Player)) {
      this.destroy();
      return;
    }

    this.youtube = new YT.Player(this.iframeHost[0], {
      height: window.innerHeight * 2,
      width: window.innerWidth,
      videoId: this.video.id,
      playerVars: {
        controls: 0,
        showinfo: 0,
        autohide: 1,
        modestbranding: 1,
        autoplay: 1,
        disablekb: 1,
        fs: 0,
        enablejsapi: 1,
        playsinline: 1,
        rel: 0,
        iv_load_policy: 3,
        // loop работает через playlist
        loop: 1,
        playlist: this.video.id,
        suggestedQuality: 'hd1080',
        mute: 1
      },
      events: {
        onReady: function () {
          _this.loaded = true;
          try { _this.youtube.setPlaybackQuality('hd1080'); } catch (e) {}
          _this.play();
        },
        onStateChange: function (state) {
          if (_this.destroyed) return;

          if (state.data === YT.PlayerState.PLAYING) {
            _this.playing = true;
            _this.html.addClass('playing');

            // пытаемся включить звук сразу (твой запрос)
            _this.unmute(false);

            // если всё равно muted — покажем маленькую подсказку, как “remote” но минимально
            setTimeout(function () {
              if (_this.destroyed) return;
              if (!_this.isActive()) return;

              try {
                var muted = _this.youtube.isMuted && _this.youtube.isMuted();
                if (muted) {
                  _this.hint.addClass('show');
                  document.addEventListener('keydown', _this.onKeyDown, true);
                } else {
                  _this.hint.removeClass('show');
                  document.removeEventListener('keydown', _this.onKeyDown, true);
                }
              } catch (e) {}
            }, 500);
          }

          if (state.data === YT.PlayerState.PAUSED) {
            _this.playing = false;
            _this.html.removeClass('playing');
          }

          if (state.data === YT.PlayerState.ENDED) {
            try {
              _this.youtube.seekTo(0, true);
              _this.youtube.playVideo();
            } catch (e) {}
          }

          if (state.data === YT.PlayerState.BUFFERING) {
            try { state.target.setPlaybackQuality('hd1080'); } catch (e) {}
          }
        },
        onError: function () {
          _this.destroy();
        }
      }
    });
  };

  BgPlayer.prototype.play = function () {
    if (!this.loaded || this.destroyed) return;
    if (!this.isActive()) return;

    try { this.youtube.playVideo(); } catch (e) {}
  };

  BgPlayer.prototype.pause = function () {
    if (!this.loaded || this.destroyed) return;
    try { this.youtube.pauseVideo(); } catch (e) {}
  };

  BgPlayer.prototype.unmute = function (force) {
    if (!this.loaded || this.destroyed) return;

    try {
      // если уже размьючено один раз — пробуем каждый раз
      this.youtube.unMute();
      this.youtube.setVolume(100);

      // если сработало — убираем подсказку и запоминаем
      if (this.youtube.isMuted && !this.youtube.isMuted()) {
        this.hint.removeClass('show');
        document.removeEventListener('keydown', this.onKeyDown, true);
        window.cardify_fist_unmute = true;
      } else {
        // если force (OK) — оставим подсказку
        if (force) this.hint.addClass('show');
      }
    } catch (e) {}
  };

  BgPlayer.prototype.destroy = function () {
    this.destroyed = true;

    try { document.removeEventListener('keydown', this.onKeyDown, true); } catch (e) {}

    try { if (this.youtube && this.youtube.destroy) this.youtube.destroy(); } catch (e) {}
    try { this.html.remove(); } catch (e) {}
  };

  // -----------------------------
  // Background Trailer controller (lifecycle)
  // -----------------------------
  function BgTrailer(object, video) {
    var _this = this;

    this.object = object;
    this.activity = object.activity;
    this.video = video;

    this.activity.bgtrailer_ready = true;

    this.player = new BgPlayer(this.activity, video);

    this.onToggle = function () {
      if (!_this.same()) return;

      if (Lampa.Controller.enabled().name === 'full_start') {
        _this.player.play();
      } else {
        _this.player.pause();
      }
    };

    this.onActivity = function (e) {
      if (e.type === 'destroy' && e.object && e.object.activity === _this.activity) {
        _this.destroy();
      }
    };

    Lampa.Controller.listener.follow('toggle', this.onToggle);
    Lampa.Listener.follow('activity', this.onActivity);

    // на старте
    this.onToggle();
  }

  BgTrailer.prototype.same = function () {
    try { return Lampa.Activity.active().activity === this.activity; }
    catch (e) { return false; }
  };

  BgTrailer.prototype.destroy = function () {
    try { Lampa.Controller.listener.remove('toggle', this.onToggle); } catch (e) {}
    try { Lampa.Listener.remove('activity', this.onActivity); } catch (e) {}

    try { this.player.destroy(); } catch (e) {}
    try { this.activity.bgtrailer_ready = false; } catch (e) {}
  };

  // -----------------------------
  // Main plugin start (Cardify UI + bg trailer)
  // -----------------------------
  function startPlugin() {
    if (!isTV()) return;

    // Lang (как в оригинале)
    try {
      Lampa.Lang.add({
        cardify_enable_sound: {
          ru: 'Включить звук',
          en: 'Enable sound',
          uk: 'Увімкнути звук',
          be: 'Уключыць гук',
          zh: '启用声音',
          pt: 'Ativar som',
          bg: 'Включване на звук'
        },
        cardify_enable_trailer: {
          ru: 'Показывать трейлер',
          en: 'Show trailer',
          uk: 'Показувати трейлер',
          be: 'Паказваць трэйлер',
          zh: '显示预告片',
          pt: 'Mostrar trailer',
          bg: 'Показване на трейлър'
        }
      });
    } catch (e) {}

    // Template (как в оригинале — даёт тот самый минимализм)
    try {
      Lampa.Template.add('full_start_new',
        "<div class=\"full-start-new cardify\">\n" +
        "  <div class=\"full-start-new__body\">\n" +
        "    <div class=\"full-start-new__left hide\">\n" +
        "      <div class=\"full-start-new__poster\">\n" +
        "        <img class=\"full-start-new__img full--poster\" />\n" +
        "      </div>\n" +
        "    </div>\n" +
        "    <div class=\"full-start-new__right\">\n" +
        "      <div class=\"cardify__left\">\n" +
        "        <div class=\"full-start-new__head\"></div>\n" +
        "        <div class=\"full-start-new__title\">{title}</div>\n" +
        "        <div class=\"cardify__details\">\n" +
        "          <div class=\"full-start-new__details\"></div>\n" +
        "        </div>\n" +
        "        <div class=\"full-start-new__buttons\">\n" +
        "          <div class=\"full-start__button selector button--play\">\n" +
        "            <svg width=\"28\" height=\"29\" viewBox=\"0 0 28 29\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n" +
        "              <circle cx=\"14\" cy=\"14.5\" r=\"13\" stroke=\"currentColor\" stroke-width=\"2.7\"/>\n" +
        "              <path d=\"M18.0739 13.634C18.7406 14.0189 18.7406 14.9811 18.0739 15.366L11.751 19.0166C11.0843 19.4015 10.251 18.9204 10.251 18.1506L10.251 10.8494C10.251 10.0796 11.0843 9.5985 11.751 9.9834L18.0739 13.634Z\" fill=\"currentColor\"/>\n" +
        "            </svg>\n" +
        "            <span>#{title_watch}</span>\n" +
        "          </div>\n" +
        "          <div class=\"full-start__button selector button--book\">\n" +
        "            <svg width=\"21\" height=\"32\" viewBox=\"0 0 21 32\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n" +
        "              <path d=\"M2 1.5H19C19.2761 1.5 19.5 1.72386 19.5 2V27.9618C19.5 28.3756 19.0261 28.6103 18.697 28.3595L12.6212 23.7303C11.3682 22.7757 9.63183 22.7757 8.37885 23.7303L2.30302 28.3595C1.9739 28.6103 1.5 28.3756 1.5 27.9618V2C1.5 1.72386 1.72386 1.5 2 1.5Z\" stroke=\"currentColor\" stroke-width=\"2.5\"/>\n" +
        "            </svg>\n" +
        "            <span>#{settings_input_links}</span>\n" +
        "          </div>\n" +
        "          <div class=\"full-start__button selector button--reaction\">\n" +
        "            <svg width=\"38\" height=\"34\" viewBox=\"0 0 38 34\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n" +
        "              <path d=\"M37.208 10.9742C37.1364 10.8013 37.0314 10.6441 36.899 10.5117C36.7666 10.3794 36.6095 10.2744 36.4365 10.2028L12.0658 0.108375C11.7166 -0.0361828 11.3242 -0.0361227 10.9749 0.108542C10.6257 0.253206 10.3482 0.530634 10.2034 0.879836L0.108666 25.2507C0.0369593 25.4236 3.37953e-05 25.609 2.3187e-08 25.7962C-3.37489e-05 25.9834 0.0368249 26.1688 0.108469 26.3418C0.180114 26.5147 0.28514 26.6719 0.417545 26.8042C0.54995 26.9366 0.707139 27.0416 0.880127 27.1131L17.2452 33.8917C17.5945 34.0361 17.9869 34.0361 18.3362 33.8917L29.6574 29.2017C29.8304 29.1301 29.9875 29.0251 30.1199 28.8928C30.2523 28.7604 30.3573 28.6032 30.4289 28.4303L37.2078 12.065C37.2795 11.8921 37.3164 11.7068 37.3164 11.5196C37.3165 11.3325 37.2796 11.1471 37.208 10.9742ZM20.425 29.9407L21.8784 26.4316L25.3873 27.885L20.425 29.9407ZM28.3407 26.0222L21.6524 23.252C21.3031 23.1075 20.9107 23.1076 20.5615 23.2523C20.2123 23.3969 19.9348 23.6743 19.79 24.0235L17.0194 30.7123L3.28783 25.0247L12.2918 3.28773L34.0286 12.2912L28.3407 26.0222Z\" fill=\"currentColor\"/>\n" +
        "              <path d=\"M25.3493 16.976L24.258 14.3423L16.959 17.3666L15.7196 14.375L13.0859 15.4659L15.4161 21.0916L25.3493 16.976Z\" fill=\"currentColor\"/>\n" +
        "            </svg>\n" +
        "            <span>#{title_reactions}</span>\n" +
        "          </div>\n" +
        "          <div class=\"full-start__button selector button--subscribe hide\">\n" +
        "            <svg width=\"25\" height=\"30\" viewBox=\"0 0 25 30\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n" +
        "              <path d=\"M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7367 27 9.27804 25.6961 9.03542 24H6.01892Z\" fill=\"currentColor\"/>\n" +
        "              <path d=\"M3.81972 14.5957V10.2679C3.81972 5.41336 7.7181 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.2106 22.9392 23.5 20.9098 23.5H4.09021C2.06084 23.5 0.792282 21.2106 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z\" stroke=\"currentColor\" stroke-width=\"2.5\"/>\n" +
        "            </svg>\n" +
        "            <span>#{title_subscribe}</span>\n" +
        "          </div>\n" +
        "          <div class=\"full-start__button selector button--options\">\n" +
        "            <svg width=\"38\" height=\"10\" viewBox=\"0 0 38 10\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n" +
        "              <circle cx=\"4.88968\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n" +
        "              <circle cx=\"18.9746\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n" +
        "              <circle cx=\"33.0596\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n" +
        "            </svg>\n" +
        "          </div>\n" +
        "        </div>\n" +
        "      </div>\n" +
        "      <div class=\"cardify__right\">\n" +
        "        <div class=\"full-start-new__reactions selector\"><div>#{reactions_none}</div></div>\n" +
        "        <div class=\"full-start-new__rate-line\">\n" +
        "          <div class=\"full-start__pg hide\"></div>\n" +
        "          <div class=\"full-start__status hide\"></div>\n" +
        "        </div>\n" +
        "      </div>\n" +
        "    </div>\n" +
        "  </div>\n" +
        "  <div class=\"hide buttons--container\">\n" +
        "    <div class=\"full-start__button view--torrent hide\"><span>#{full_torrents}</span></div>\n" +
        "    <div class=\"full-start__button selector view--trailer\"><span>#{full_trailers}</span></div>\n" +
        "  </div>\n" +
        "</div>"
      );
    } catch (e) {}

    // CSS (оригинальный cardify + добавка для BG трейлера)
    var cssText =
      ".cardify{-webkit-transition:all .3s;transition:all .3s}" +
      ".cardify .full-start-new__body{height:80vh}" +
      ".cardify .full-start-new__right{display:flex;align-items:flex-end}" +
      ".cardify .full-start-new__title{text-shadow:0 0 .1em rgba(0,0,0,0.3)}" +
      ".cardify__left{flex-grow:1}" +
      ".cardify__right{display:flex;align-items:center;flex-shrink:0;position:relative}" +
      ".cardify__details{display:flex}" +
      ".cardify .full-start-new__reactions{margin:0;margin-right:-2.8em}" +
      ".cardify .full-start-new__reactions:not(.focus)>div:not(:first-child){display:none}" +
      ".cardify .full-start-new__rate-line{margin:0;margin-left:3.5em}" +
      ".cardify__background{left:0;overflow:hidden}" +
      "body:not(.menu--open) .cardify__background{-webkit-mask-image:-webkit-linear-gradient(top,white 50%,rgba(255,255,255,0) 100%);mask-image:linear-gradient(to bottom,white 50%,rgba(255,255,255,0) 100%)}" +

      // BG video layer
      ".cardify-bgvideo{position:absolute;top:-60%;bottom:-60%;left:0;width:100%;display:flex;align-items:center;pointer-events:none;opacity:0;transition:opacity .35s}" +
      ".cardify-bgvideo.playing{opacity:1}" +
      ".cardify-bgvideo iframe{border:0;width:100%;height:100%;min-height:100%;min-width:100%}" +
      ".cardify-bgvideo__shade{position:absolute;inset:0;background:linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.10) 55%, rgba(0,0,0,.22) 100%)}" +
      ".cardify-bgvideo__hint{position:absolute;right:1.2em;bottom:1.2em;padding:.55em .95em;border-radius:1.6em;background:rgba(0,0,0,.22);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transform:translate3d(0,10px,0);transition:all .25s;font-size:1.05em}" +
      ".cardify-bgvideo__hint.show{opacity:.9;transform:translate3d(0,0,0)}";

    addOnceStyle('cardify_bgtrailer_css', cssText);

    // Settings UI (как в оригинале)
    try {
      var icon = "<svg width=\"36\" height=\"28\" viewBox=\"0 0 36 28\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1.5\" y=\"1.5\" width=\"33\" height=\"25\" rx=\"3.5\" stroke=\"white\" stroke-width=\"3\"/><rect x=\"5\" y=\"14\" width=\"17\" height=\"4\" rx=\"2\" fill=\"white\"/><rect x=\"5\" y=\"20\" width=\"10\" height=\"3\" rx=\"1.5\" fill=\"white\"/><rect x=\"25\" y=\"20\" width=\"6\" height=\"3\" rx=\"1.5\" fill=\"white\"/></svg>";
      Lampa.SettingsApi.addComponent({ component: 'cardify', icon: icon, name: 'Cardify' });

      if (!Lampa.Storage.field('cardify_run_trailers')) {
        // просто чтобы поле существовало
      }

      Lampa.SettingsApi.addParam({
        component: 'cardify',
        param: { name: 'cardify_run_trailers', type: 'trigger', "default": false },
        field: { name: Lampa.Lang.translate('cardify_enable_trailer') }
      });
    } catch (e) {}

    // Hook FULL (как в оригинале, но вместо full-screen трейлера — background)
    Lampa.Listener.follow('full', function (e) {
      var type = e && e.type;
      if (!(type === 'complite' || type === 'complete')) return;

      // включено ли в настройках
      try {
        if (!Lampa.Storage.field('cardify_run_trailers')) return;
      } catch (err) { return; }

      // не дублировать
      if (e.object && e.object.activity && e.object.activity.bgtrailer_ready) return;

      // только активная карточка
      try {
        if (Lampa.Activity.active().activity !== e.object.activity) return;
      } catch (err2) {}

      // версия приложения (как в оригинале)
      try {
        if (Lampa.Manifest && Lampa.Manifest.app_digital && Lampa.Manifest.app_digital < 220) return;
      } catch (err3) {}

      // делаем фон "cardify__background" (как в Follow.skodf)
      try {
        e.object.activity.render().find('.full-start__background').addClass('cardify__background');
      } catch (err4) {}

      var trailer = pickTrailer(e.data);
      if (!trailer) return;

      new BgTrailer(e.object, trailer);
    });
  }

  // старт по ready (как у оригинала)
  if (window['app' + 're' + 'ady']) startPlugin();
  else {
    try {
      Lampa.Listener.follow('app', function (e) {
        if (e && e.type === 'ready') startPlugin();
      });
    } catch (e) {}
  }
})();
