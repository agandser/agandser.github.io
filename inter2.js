(function () {
  'use strict';

  if (!window.Lampa) return;
  if (Lampa.Platform && Lampa.Platform.screen && !Lampa.Platform.screen('tv')) return;

  var SETTINGS_SHOW = 'cardify_bg_trailer';
  var SETTINGS_SOUND = 'cardify_bg_trailer_sound';
  var SETTINGS_UNMUTED_ONCE = 'cardify_bg_trailer_unmuted_once';

  function safeField(key, def) {
    try {
      var v = Lampa.Storage.field(key);
      return typeof v === 'undefined' ? def : v;
    } catch (e) { return def; }
  }

  // ---------- Lang ----------
  try {
    Lampa.Lang.add({
      cardify_bgtrailer_enable: { ru: 'Трейлер в фоне', en: 'Backdrop trailer' },
      cardify_bgtrailer_sound: { ru: 'Трейлер со звуком', en: 'Trailer with sound' },
      cardify_bgtrailer_press_any: { ru: 'Нажмите любую кнопку для звука', en: 'Press any key for sound' }
    });
  } catch (e) {}

  // ---------- Settings ----------
  try {
    if (Lampa.SettingsApi) {
      var icon = "<svg width=\"36\" height=\"28\" viewBox=\"0 0 36 28\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1.5\" y=\"1.5\" width=\"33\" height=\"25\" rx=\"3.5\" stroke=\"white\" stroke-width=\"3\"/><rect x=\"5\" y=\"14\" width=\"17\" height=\"4\" rx=\"2\" fill=\"white\"/><rect x=\"5\" y=\"20\" width=\"10\" height=\"3\" rx=\"1.5\" fill=\"white\"/><rect x=\"25\" y=\"20\" width=\"6\" height=\"3\" rx=\"1.5\" fill=\"white\"/></svg>";

      Lampa.SettingsApi.addComponent({ component: 'cardify_bgtrailer', icon: icon, name: 'Backdrop Trailer' });

      Lampa.SettingsApi.addParam({
        component: 'cardify_bgtrailer',
        param: { name: SETTINGS_SHOW, type: 'trigger', 'default': true },
        field: { name: Lampa.Lang.translate('cardify_bgtrailer_enable') }
      });

      Lampa.SettingsApi.addParam({
        component: 'cardify_bgtrailer',
        param: { name: SETTINGS_SOUND, type: 'trigger', 'default': true },
        field: { name: Lampa.Lang.translate('cardify_bgtrailer_sound') }
      });
    }
  } catch (e) {}

  // ---------- CSS (ВАЖНО: слой фиксированный, UI не трогаем) ----------
  var css = [
    "<style>",
    ".cardify-bgtrailer{position:fixed;inset:-12% 0;overflow:hidden;pointer-events:none;opacity:0;transition:opacity .45s ease;z-index:1;}",
    "body.bgtrailer-on .cardify-bgtrailer{opacity:1;}",
    ".cardify-bgtrailer__host{position:absolute;inset:0;}",
    ".cardify-bgtrailer iframe{position:absolute;top:50%;left:50%;width:160vw;height:90vw;min-width:100%;min-height:100%;transform:translate(-50%,-50%);border:0;}",
    ".cardify-bgtrailer__shade{position:absolute;inset:0;background:linear-gradient(90deg, rgba(0,0,0,.62) 0%, rgba(0,0,0,.25) 45%, rgba(0,0,0,.62) 100%);}",
    ".cardify-bgtrailer__vignette{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,.35) 75%, rgba(0,0,0,.62) 100%);}",
    ".cardify-bgtrailer__hint{position:fixed;right:1.2em;bottom:1.2em;display:flex;align-items:center;gap:.7em;padding:.65em 1em;border-radius:1.6em;background:rgba(0,0,0,.45);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transform:translate3d(0,10px,0);transition:all .3s ease;z-index:3;}",
    ".cardify-bgtrailer__hint.show{opacity:1;transform:translate3d(0,0,0);}",
    ".cardify-bgtrailer__hint svg{width:1.6em;height:1.6em;opacity:.9;}",
    ".cardify-bgtrailer__hint span{font-size:1.1em;opacity:.95;}",

    // Когда видео реально пошло — прячем статический фон (но НЕ двигаем раскладку)
    "body.bgtrailer-on .full-start__background{opacity:0 !important;}",
    // Контент выше видео
    "body.bgtrailer-on .full-start, body.bgtrailer-on .full-start-new{position:relative;z-index:2;}",
    "</style>"
  ].join("\n");
  try { $('body').append(css); } catch (e) {}

  // ---------- YouTube API loader ----------
  var ytWaiters = [];
  var ytLoading = false;

  function ensureYT(cb) {
    if (window.YT && YT.Player) return cb();
    ytWaiters.push(cb);
    if (ytLoading) return;
    ytLoading = true;

    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);

    var prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      try { if (typeof prev === 'function') prev(); } catch (e) {}
      var list = ytWaiters.slice(0);
      ytWaiters = [];
      for (var i = 0; i < list.length; i++) { try { list[i](); } catch (e) {} }
    };
  }

  // ---------- Trailer picker ----------
  function pickTrailer(data) {
    if (!data || !data.videos || !data.videos.results || !data.videos.results.length) return null;

    var items = [];
    data.videos.results.forEach(function (el) {
      if (!el || !el.key) return;
      items.push({
        title: (el.name || '').slice(0, 80),
        id: el.key,
        code: el.iso_639_1 || '',
        time: el.published_at ? new Date(el.published_at).getTime() : 0
      });
    });

    if (!items.length) return null;

    items.sort(function (a, b) { return (a.time > b.time ? -1 : a.time < b.time ? 1 : 0); });

    var lang = '';
    try { lang = Lampa.Storage.field('tmdb_lang') || ''; } catch (e) {}

    var byLang = items.filter(function (n) { return n.code === lang; });
    var byEn = items.filter(function (n) { return n.code === 'en' && byLang.indexOf(n) === -1; });

    var pool = [];
    if (byLang.length) pool = pool.concat(byLang);
    pool = pool.concat(byEn);
    if (!pool.length) pool = items;

    return pool[0];
  }

  // ---------- Backdrop Trailer (фикс-слой) ----------
  function BackdropTrailer(fullObject, trailer) {
    var self = this;

    this.object = fullObject;
    this.activity = fullObject.activity;
    this.trailer = trailer;

    this.destroyed = false;
    this.started = false;

    this.autoSound = !!safeField(SETTINGS_SOUND, true);
    this.showEnabled = !!safeField(SETTINGS_SHOW, true);

    this.wrap = $([
      '<div class="cardify-bgtrailer">',
        '<div class="cardify-bgtrailer__host"></div>',
        '<div class="cardify-bgtrailer__shade"></div>',
        '<div class="cardify-bgtrailer__vignette"></div>',
      '</div>'
    ].join(''));

    this.hint = $([
      '<div class="cardify-bgtrailer__hint">',
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
          '<path d="M3 10V14H7L12 18V6L7 10H3Z" fill="white" fill-opacity="0.9"/>',
          '<path d="M16.5 8.5C17.7 9.7 18.4 11.3 18.4 13C18.4 14.7 17.7 16.3 16.5 17.5" stroke="white" stroke-opacity="0.75" stroke-width="2" stroke-linecap="round"/>',
        '</svg>',
        '<span>' + (Lampa.Lang ? Lampa.Lang.translate('cardify_bgtrailer_press_any') : 'Press any key for sound') + '</span>',
      '</div>'
    ].join(''));

    this.host = this.wrap.find('.cardify-bgtrailer__host');

    // Вклеиваем в body (НЕ в background!)
    $('body').append(this.wrap).append(this.hint);

    // События жизненного цикла
    this.onActivity = function (e) {
      if (!e || e.type !== 'destroy') return;
      if (e.object && e.object.activity === self.activity) self.destroy();
    };
    this.onToggle = function () {
      if (self.destroyed) return;
      if (!self.isOnThisFullStart()) self.pause(true);
      else self.play();
    };
    this.onAnyKeyDown = function () {
      self.tryUnmute(true);
      self.detachAnyKey();
    };

    Lampa.Listener.follow('activity', this.onActivity);
    Lampa.Controller.listener.follow('toggle', this.onToggle);

    ensureYT(function () {
      if (self.destroyed) return;
      self.createPlayer();
    });
  }

  BackdropTrailer.prototype.isOnThisFullStart = function () {
    try {
      return Lampa.Activity.active().activity === this.activity &&
        Lampa.Controller.enabled().name === 'full_start';
    } catch (e) { return false; }
  };

  BackdropTrailer.prototype.createPlayer = function () {
    var self = this;
    if (!window.YT || !YT.Player) return this.destroy();

    // autoplay надёжнее со startMuted, потом пытаемся снять mute
    var startMuted = true;

    this.player = new YT.Player(this.host[0], {
      videoId: this.trailer.id,
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
        playlist: this.trailer.id,
        mute: startMuted ? 1 : 0
      },
      events: {
        onReady: function () {
          setTimeout(function () {
            if (self.destroyed) return;
            if (!self.showEnabled) return;
            if (!self.isOnThisFullStart()) return;
            self.play();
          }, 600);
        },
        onStateChange: function (st) {
          if (self.destroyed) return;

          if (st.data === YT.PlayerState.PLAYING) {
            self.started = true;

            // ВАЖНО: только когда реально PLAYING — включаем режим “видео вместо статики”
            document.body.classList.add('bgtrailer-on');

            // Звук
            if (self.autoSound) {
              var already = !!safeField(SETTINGS_UNMUTED_ONCE, false);
              self.tryUnmute(already);

              // Если всё ещё muted — покажем подсказку и ждём кнопку
              setTimeout(function () {
                if (self.destroyed || !self.player) return;
                try {
                  if (self.player.isMuted && self.player.isMuted()) {
                    self.hint.addClass('show');
                    self.attachAnyKey();
                  } else {
                    self.hint.removeClass('show');
                    self.detachAnyKey();
                  }
                } catch (e) {}
              }, 500);
            }
          }

          if (st.data === YT.PlayerState.BUFFERING) {
            try { st.target.setPlaybackQuality('hd1080'); } catch (e) {}
          }

          if (st.data === YT.PlayerState.ENDED) {
            try { self.player.seekTo(0, true); self.player.playVideo(); } catch (e) {}
          }
        },
        onError: function () {
          self.destroy();
        }
      }
    });
  };

  BackdropTrailer.prototype.attachAnyKey = function () {
    if (this._anyKeyAttached) return;
    this._anyKeyAttached = true;
    document.addEventListener('keydown', this.onAnyKeyDown, true);
  };

  BackdropTrailer.prototype.detachAnyKey = function () {
    if (!this._anyKeyAttached) return;
    this._anyKeyAttached = false;
    document.removeEventListener('keydown', this.onAnyKeyDown, true);
  };

  BackdropTrailer.prototype.tryUnmute = function (aggressive) {
    if (!this.player || !this.autoSound) return;
    try {
      if (this.player.unMute) this.player.unMute();
      if (this.player.setVolume) this.player.setVolume(100);

      if (this.player.isMuted && !this.player.isMuted()) {
        try { Lampa.Storage.set(SETTINGS_UNMUTED_ONCE, true); } catch (e) {}
        this.hint.removeClass('show');
      } else {
        if (aggressive) this.hint.addClass('show');
      }
    } catch (e) {}
  };

  BackdropTrailer.prototype.play = function () {
    if (!this.player || this.destroyed || !this.showEnabled) return;
    if (!this.isOnThisFullStart()) return;
    try { this.player.playVideo(); } catch (e) {}
  };

  BackdropTrailer.prototype.pause = function (hide) {
    if (!this.player || this.destroyed) return;
    try { this.player.pauseVideo(); } catch (e) {}
    if (hide) document.body.classList.remove('bgtrailer-on');
  };

  BackdropTrailer.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;

    document.body.classList.remove('bgtrailer-on');
    try { this.detachAnyKey(); } catch (e) {}

    try { Lampa.Listener.remove('activity', this.onActivity); } catch (e) {}
    try { Lampa.Controller.listener.remove('toggle', this.onToggle); } catch (e) {}

    try { if (this.player && this.player.destroy) this.player.destroy(); } catch (e) {}

    try { this.wrap.remove(); } catch (e) {}
    try { this.hint.remove(); } catch (e) {}

    try { this.activity.bg_trailer_ready = false; } catch (e) {}
  };

  // ---------- Hook ----------
  Lampa.Listener.follow('full', function (e) {
    try {
      var ok = e && (e.type === 'complite' || e.type === 'complete');
      if (!ok) return;

      if (!safeField(SETTINGS_SHOW, true)) return;

      // Только на активной карточке
      if (Lampa.Activity.active().activity !== e.object.activity) return;

      // Дубль-защита
      if (e.object.activity.bg_trailer_ready) return;

      var trailer = pickTrailer(e.data);
      if (!trailer) return;

      e.object.activity.bg_trailer_ready = true;
      new BackdropTrailer(e.object, trailer);
    } catch (err) {}
  });

})();
