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

    // 1) Находим фон. Важно: иногда это IMG.
    this.bgNode = this.activity.render().find('.full-start__background').eq(0);

    // 2) Holder — куда реально можно вставить слой.
    this.holder = this.bgNode;

    if (this.bgNode.length) {
      var tag = (this.bgNode[0].tagName || '').toLowerCase();
      if (tag === 'img') this.holder = this.bgNode.parent();
    }

    if (!this.holder || !this.holder.length) {
      // fallback — хотя обычно не понадобится
      this.holder = this.activity.render().find('.activity__body').eq(0);
    }

    // 3) Статичная картинка фона (которую будем гасить при старте видео)
    this.bgImg = null;
    if (this.bgNode.length) {
      var tag2 = (this.bgNode[0].tagName || '').toLowerCase();
      if (tag2 === 'img') this.bgImg = this.bgNode;
      else {
        // если фон контейнер, внутри обычно есть img
        this.bgImg = this.bgNode.find('img').eq(0);
        if (!this.bgImg.length) this.bgImg = null;
      }
    }

    // DOM layer
    this.html = $(
      '<div class="cardify-bgvideo">' +
        '<div class="cardify-bgvideo__iframe"></div>' +
        '<div class="cardify-bgvideo__shade"></div>' +
        '<div class="cardify-bgvideo__hint"><span>' + (Lampa.Lang ? Lampa.Lang.translate('cardify_enable_sound') : 'Enable sound') + ' (OK)</span></div>' +
      '</div>'
    );

    this.iframeHost = this.html.find('.cardify-bgvideo__iframe');
    this.hint = this.html.find('.cardify-bgvideo__hint');

    // Вставляем в holder (а не в img)
    this.holder.append(this.html);

    // Keydown для unmute по OK/Enter
    this.onKeyDown = function (e) {
      if (_this.destroyed) return;
      if (!_this.isActive()) return;

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

  BgPlayer.prototype.setStaticHidden = function (hide) {
    try {
      if (this.bgNode && this.bgNode.length) {
        if (hide) this.bgNode.addClass('bgvideo-on');
        else this.bgNode.removeClass('bgvideo-on');
      }
      if (this.bgImg && this.bgImg.length) {
        // На всякий — прямым стилем тоже
        this.bgImg.css('opacity', hide ? '0' : '');
      }
    } catch (e) {}
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

            // вот тут “фон заменяется”: гасим статичное
            _this.setStaticHidden(true);

            // пробуем звук
            _this.unmute(false);

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
            _this.setStaticHidden(false);
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
          _this.setStaticHidden(false);
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
      this.youtube.unMute();
      this.youtube.setVolume(100);

      if (this.youtube.isMuted && !this.youtube.isMuted()) {
        this.hint.removeClass('show');
        document.removeEventListener('keydown', this.onKeyDown, true);
        window.cardify_fist_unmute = true;
      } else {
        if (force) this.hint.addClass('show');
      }
    } catch (e) {}
  };

  BgPlayer.prototype.destroy = function () {
    this.destroyed = true;

    try { this.setStaticHidden(false); } catch (e) {}
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

      if (Lampa.Controller.enabled().name === 'full_start') _this.player.play();
      else _this.player.pause();
    };

    this.onActivity = function (e) {
      if (e.type === 'destroy' && e.object && e.object.activity === _this.activity) _this.destroy();
    };

    Lampa.Controller.listener.follow('toggle', this.onToggle);
    Lampa.Listener.follow('activity', this.onActivity);

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

    // Lang
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

    // Template (минимализм)
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
        "        <div class=\"cardify__details\"><div class=\"full-start-new__details\"></div></div>\n" +
        "        <div class=\"full-start-new__buttons\">\n" +
        "          <div class=\"full-start__button selector button--play\"><span>#{title_watch}</span></div>\n" +
        "          <div class=\"full-start__button selector button--book\"><span>#{settings_input_links}</span></div>\n" +
        "          <div class=\"full-start__button selector button--reaction\"><span>#{title_reactions}</span></div>\n" +
        "          <div class=\"full-start__button selector button--options\"></div>\n" +
        "        </div>\n" +
        "      </div>\n" +
        "      <div class=\"cardify__right\">\n" +
        "        <div class=\"full-start-new__reactions selector\"><div>#{reactions_none}</div></div>\n" +
        "        <div class=\"full-start-new__rate-line\"><div class=\"full-start__pg hide\"></div><div class=\"full-start__status hide\"></div></div>\n" +
        "      </div>\n" +
        "    </div>\n" +
        "  </div>\n" +
        "</div>"
      );
    } catch (e) {}

    // CSS (cardify + bg trailer) + важное: скрытие статики
    var cssText =
      ".cardify{-webkit-transition:all .3s;transition:all .3s}" +
      ".cardify .full-start-new__body{height:80vh}" +
      ".cardify .full-start-new__right{display:flex;align-items:flex-end}" +
      ".cardify__left{flex-grow:1}" +
      ".cardify__right{display:flex;align-items:center;flex-shrink:0;position:relative}" +
      ".cardify__details{display:flex}" +
      ".cardify__background{left:0;overflow:hidden}" +
      "body:not(.menu--open) .cardify__background{-webkit-mask-image:-webkit-linear-gradient(top,white 50%,rgba(255,255,255,0) 100%);mask-image:linear-gradient(to bottom,white 50%,rgba(255,255,255,0) 100%)}" +

      // BG video layer (поверх статики, но под UI)
      ".cardify-bgvideo{position:absolute;inset:-60% 0;display:flex;align-items:center;pointer-events:none;opacity:0;transition:opacity .35s;z-index:3}" +
      ".cardify-bgvideo.playing{opacity:1}" +
      ".cardify-bgvideo iframe{border:0;width:100%;height:100%}" +
      ".cardify-bgvideo__shade{position:absolute;inset:0;background:linear-gradient(90deg, rgba(0,0,0,.28) 0%, rgba(0,0,0,.10) 55%, rgba(0,0,0,.22) 100%);z-index:4}" +
      ".cardify-bgvideo__hint{position:absolute;right:1.2em;bottom:1.2em;padding:.55em .95em;border-radius:1.6em;background:rgba(0,0,0,.22);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transform:translate3d(0,10px,0);transition:all .25s;font-size:1.05em;z-index:5}" +
      ".cardify-bgvideo__hint.show{opacity:.9;transform:translate3d(0,0,0)}" +

      // Скрытие статичного фона при старте видео
      ".full-start__background.bgvideo-on{background-image:none !important}" +
      ".full-start__background.bgvideo-on>img{opacity:0 !important;transition:opacity .25s}";

    addOnceStyle('cardify_bgtrailer_css', cssText);

    // Settings UI
    try {
      var icon = "<svg width=\"36\" height=\"28\" viewBox=\"0 0 36 28\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1.5\" y=\"1.5\" width=\"33\" height=\"25\" rx=\"3.5\" stroke=\"white\" stroke-width=\"3\"/></svg>";
      Lampa.SettingsApi.addComponent({ component: 'cardify', icon: icon, name: 'Cardify' });

      Lampa.SettingsApi.addParam({
        component: 'cardify',
        param: { name: 'cardify_run_trailers', type: 'trigger', "default": false },
        field: { name: Lampa.Lang.translate('cardify_enable_trailer') }
      });
    } catch (e) {}

    // Hook FULL
    Lampa.Listener.follow('full', function (e) {
      var type = e && e.type;
      if (!(type === 'complite' || type === 'complete')) return;

      try { if (!Lampa.Storage.field('cardify_run_trailers')) return; } catch (err) { return; }
      if (e.object && e.object.activity && e.object.activity.bgtrailer_ready) return;

      try { if (Lampa.Activity.active().activity !== e.object.activity) return; } catch (err2) {}
      try {
        if (Lampa.Manifest && Lampa.Manifest.app_digital && Lampa.Manifest.app_digital < 220) return;
      } catch (err3) {}

      // делаем фон "cardify__background" (как оригинал)
      try { e.object.activity.render().find('.full-start__background').addClass('cardify__background'); } catch (err4) {}

      var trailer = pickTrailer(e.data);
      if (!trailer) return;

      new BgTrailer(e.object, trailer);
    });
  }

  // start
  if (window['app' + 're' + 'ady']) startPlugin();
  else {
    try {
      Lampa.Listener.follow('app', function (e) {
        if (e && e.type === 'ready') startPlugin();
      });
    } catch (e) {}
  }

})();
