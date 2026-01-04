(function () {
  'use strict';

  if (!window.Lampa) return;

  // -----------------------------
  // Utils
  // -----------------------------
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

  function pickTrailer(data) {
    if (!data || !data.videos || !data.videos.results || !data.videos.results.length) return null;

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

    var my_lang = [];
    var en_lang = [];
    try {
      var lang = Lampa.Storage.field('tmdb_lang');
      my_lang = items.filter(function (n) { return n.code == lang; });
      en_lang = items.filter(function (n) { return n.code == 'en' && my_lang.indexOf(n) == -1; });
    } catch (e) {}

    var al = [];
    if (my_lang.length) al = al.concat(my_lang);
    al = al.concat(en_lang);
    if (!al.length) al = items;

    return al[0] || null;
  }

  // -----------------------------
  // Background YouTube Player (behind UI)
  // -----------------------------
  function BgPlayer(activity, video) {
    var _this = this;

    this.activity = activity;
    this.video = video;

    this.loaded = false;
    this.display = false;

    this.root = activity.render();
    this.bg = this.root.find('.full-start__background').eq(0);

    this.bgTag = this.bg.length ? (this.bg[0].tagName || '').toLowerCase() : '';
    this.bgIsImg = this.bgTag === 'img';

    this.html = $(
      '<div class="cardify-bgtrailer">' +
        '<div class="cardify-bgtrailer__iframe"></div>' +
      '</div>'
    );

    // ВАЖНО:
    // - если background это IMG: нельзя append внутрь, и нельзя append в конец родителя (может стать поверх UI),
    //   поэтому вставляем СРАЗУ ПОСЛЕ .full-start__background
    // - если background контейнер: кладём внутрь
    if (this.bg.length) {
      if (this.bgIsImg) this.bg.after(this.html);
      else this.bg.append(this.html);
    } else {
      // fallback
      this.root.find('.activity__body').prepend(this.html);
    }

    this.iframeHost = this.html.find('.cardify-bgtrailer__iframe');

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
          iv_load_policy: 3,
          suggestedQuality: 'hd1080',
          setPlaybackQuality: 'hd1080',
          mute: 0 // звук у тебя уже есть — оставляем включённым
        },
        events: {
          onReady: function () {
            _this.loaded = true;
            try { _this.youtube.setPlaybackQuality('hd1080'); } catch (e) {}
          },
          onStateChange: function (state) {
            if (state.data === YT.PlayerState.PLAYING) {
              _this.display = true;
              _this.html.addClass('display');

              // Убираем статику, но НЕ контейнер
              _this.setStaticHidden(true);
            }

            if (state.data === YT.PlayerState.PAUSED) {
              _this.display = false;
              _this.html.removeClass('display');
              _this.setStaticHidden(false);
            }

            if (state.data === YT.PlayerState.ENDED) {
              // лёгкий луп
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
    });
  }

  BgPlayer.prototype.setStaticHidden = function (hide) {
    try {
      if (!this.bg || !this.bg.length) return;

      // если background div с background-image
      this.bg.toggleClass('cardify-bgtrailer--on', !!hide);

      // если внутри есть img — тоже гасим
      var img = this.bgIsImg ? this.bg : this.bg.find('img').eq(0);
      if (img && img.length) img.css('opacity', hide ? '0' : '');
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
    this.display = false;

    try { this.setStaticHidden(false); } catch (e) {}
    try { if (this.youtube && this.youtube.destroy) this.youtube.destroy(); } catch (e) {}
    try { this.html.remove(); } catch (e) {}
  };

  // -----------------------------
  // BG Trailer lifecycle (hide on scroll/down)
  // -----------------------------
  function BgTrailer(object, video) {
    var _this = this;

    object.activity.trailer_ready = true;
    this.object = object;
    this.video = video;

    this.player = new BgPlayer(object.activity, video);

    this.timelauch = 1200;
    this.firstlauch = false;

    // следим за уходом "вниз"
    this.timerCheck = null;

    this.onToggle = function () {
      _this.update();
    };

    this.onActivity = function (e) {
      if (e.type === 'destroy' && e.object.activity === _this.object.activity) _this.destroy();
    };

    Lampa.Controller.listener.follow('toggle', this.onToggle);
    Lampa.Listener.follow('activity', this.onActivity);

    // стартуем как в оригинале — через задержку
    this.start();
  }

  BgTrailer.prototype.same = function () {
    try { return Lampa.Activity.active().activity === this.object.activity; }
    catch (e) { return false; }
  };

  BgTrailer.prototype.isTopView = function () {
    // 1) основной признак — контроллер
    try {
      var name = Lampa.Controller.enabled().name;
      if (name && name !== 'full_start') return false;
    } catch (e) {}

    // 2) доп. страховка: если экран реально "уехал вверх" (перемотка вниз)
    // (работает даже если скролл сделан transform'ом)
    try {
      var body = this.object.activity.render().find('.full-start-new__body').eq(0);
      if (body.length) {
        var top = body[0].getBoundingClientRect().top;
        if (top < -20) return false;
      }
    } catch (e) {}

    return true;
  };

  BgTrailer.prototype.update = function () {
    // если не эта карточка — стоп
    if (!this.same()) {
      this.player.pause();
      return;
    }

    // если "вниз" — скрываем
    if (!this.isTopView()) {
      this.player.pause();
      return;
    }

    // если наверху — играем
    this.player.play();
  };

  BgTrailer.prototype.start = function () {
    var _this = this;

    // регулярная проверка "вниз/вверх"
    clearInterval(this.timerCheck);
    this.timerCheck = setInterval(function () {
      _this.update();
    }, 250);

    // первичная задержка как в оригинале
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

    try { Lampa.Controller.listener.remove('toggle', this.onToggle); } catch (e) {}
    try { Lampa.Listener.remove('activity', this.onActivity); } catch (e) {}

    try { this.player.destroy(); } catch (e) {}
  };

  // -----------------------------
  // Plugin start (ORIGINAL UI)
  // -----------------------------
  function startPlugin() {
    if (!Lampa.Platform.screen('tv')) return console.log('Cardify', 'no tv');

    // Lang (оригинал)
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

    // TEMPLATE (СТРОГО ОРИГИНАЛ, не трогаем минимализм)
    Lampa.Template.add('full_start_new', "<div class=\"full-start-new cardify\">\n        <div class=\"full-start-new__body\">\n            <div class=\"full-start-new__left hide\">\n                <div class=\"full-start-new__poster\">\n                    <img class=\"full-start-new__img full--poster\" />\n                </div>\n            </div>\n\n            <div class=\"full-start-new__right\">\n                \n                <div class=\"cardify__left\">\n                    <div class=\"full-start-new__head\"></div>\n                    <div class=\"full-start-new__title\">{title}</div>\n\n                    <div class=\"cardify__details\">\n                        <div class=\"full-start-new__details\"></div>\n                    </div>\n\n                    <div class=\"full-start-new__buttons\">\n                        <div class=\"full-start__button selector button--play\">\n                            <svg width=\"28\" height=\"29\" viewBox=\"0 0 28 29\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <circle cx=\"14\" cy=\"14.5\" r=\"13\" stroke=\"currentColor\" stroke-width=\"2.7\"/>\n                                <path d=\"M18.0739 13.634C18.7406 14.0189 18.7406 14.9811 18.0739 15.366L11.751 19.0166C11.0843 19.4015 10.251 18.9204 10.251 18.1506L10.251 10.8494C10.251 10.0796 11.0843 9.5985 11.751 9.9834L18.0739 13.634Z\" fill=\"currentColor\"/>\n                            </svg>\n\n                            <span>#{title_watch}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--book\">\n                            <svg width=\"21\" height=\"32\" viewBox=\"0 0 21 32\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                            <path d=\"M2 1.5H19C19.2761 1.5 19.5 1.72386 19.5 2V27.9618C19.5 28.3756 19.0261 28.6103 18.697 28.3595L12.6212 23.7303C11.3682 22.7757 9.63183 22.7757 8.37885 23.7303L2.30302 28.3595C1.9739 28.6103 1.5 28.3756 1.5 27.9618V2C1.5 1.72386 1.72386 1.5 2 1.5Z\" stroke=\"currentColor\" stroke-width=\"2.5\"/>\n                            </svg>\n\n                            <span>#{settings_input_links}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--reaction\">\n                            <svg width=\"38\" height=\"34\" viewBox=\"0 0 38 34\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <path d=\"M37.208 10.9742C37.1364 10.8013 37.0314 10.6441 36.899 10.5117C36.7666 10.3794 36.6095 10.2744 36.4365 10.2028L12.0658 0.108375C11.7166 -0.0361828 11.3242 -0.0361227 10.9749 0.108542C10.6257 0.253206 10.3482 0.530634 10.2034 0.879836L0.108666 25.2507C0.0369593 25.4236 3.37953e-05 25.609 2.3187e-08 25.7962C-3.37489e-05 25.9834 0.0368249 26.1688 0.108469 26.3418C0.180114 26.5147 0.28514 26.6719 0.417545 26.8042C0.54995 26.9366 0.707139 27.0416 0.880127 27.1131L17.2452 33.8917C17.5945 34.0361 17.9869 34.0361 18.3362 33.8917L29.6574 29.2017C29.8304 29.1301 29.9875 29.0251 30.1199 28.8928C30.2523 28.7604 30.3573 28.6032 30.4289 28.4303L37.2078 12.065C37.2795 11.8921 37.3164 11.7068 37.3164 11.5196C37.3165 11.3325 37.2796 11.1471 37.208 10.9742ZM20.425 29.9407L21.8784 26.4316L25.3873 27.885L20.425 29.9407ZM28.3407 26.0222L21.6524 23.252C21.3031 23.1075 20.9107 23.1076 20.5615 23.2523C20.2123 23.3969 19.9348 23.6743 19.79 24.0235L17.0194 30.7123L3.28783 25.0247L12.2918 3.28773L34.0286 12.2912L28.3407 26.0222Z\" fill=\"currentColor\"/>\n                                <path d=\"M25.3493 16.976L24.258 14.3423L16.959 17.3666L15.7196 14.375L13.0859 15.4659L15.4161 21.0916L25.3493 16.976Z\" fill=\"currentColor\"/>\n                            </svg>                \n\n                            <span>#{title_reactions}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--subscribe hide\">\n                            <svg width=\"25\" height=\"30\" viewBox=\"0 0 25 30\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                            <path d=\"M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7367 27 9.27804 25.6961 9.03542 24H6.01892Z\" fill=\"currentColor\"/>\n                            <path d=\"M3.81972 14.5957V10.2679C3.81972 5.41336 7.7181 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.2106 22.9392 23.5 20.9098 23.5H4.09021C2.06084 23.5 0.792282 21.2106 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z\" stroke=\"currentColor\" stroke-width=\"2.5\"/>\n                            </svg>\n\n                            <span>#{title_subscribe}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--options\">\n                            <svg width=\"38\" height=\"10\" viewBox=\"0 0 38 10\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <circle cx=\"4.88968\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                                <circle cx=\"18.9746\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                                <circle cx=\"33.0596\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                            </svg>\n                        </div>\n                    </div>\n                </div>\n\n                <div class=\"cardify__right\">\n                    <div class=\"full-start-new__reactions selector\">\n                        <div>#{reactions_none}</div>\n                    </div>\n\n                    <div class=\"full-start-new__rate-line\">\n                        <div class=\"full-start__pg hide\"></div>\n                        <div class=\"full-start__status hide\"></div>\n                    </div>\n                </div>\n            </div>\n        </div>\n\n        <div class=\"hide buttons--container\">\n            <div class=\"full-start__button view--torrent hide\">\n                <svg xmlns=\"http://www.w3.org/2000/svg\"  viewBox=\"0 0 50 50\" width=\"50px\" height=\"50px\">\n                    <path d=\"M25,2C12.317,2,2,12.317,2,25s10.317,23,23,23s23-10.317,23-23S37.683,2,25,2z M40.5,30.963c-3.1,0-4.9-2.4-4.9-2.4 S34.1,35,27,35c-1.4,0-3.6-0.837-3.6-0.837l4.17,9.643C26.727,43.92,25.874,44,25,44c-2.157,0-4.222-0.377-6.155-1.039L9.237,16.851 c0,0-0.7-1.2,0.4-1.5c1.1-0.3,5.4-1.2,5.4-1.2s1.475-0.494,1.8,0.5c0.5,1.3,4.063,11.112,4.063,11.112S22.6,29,27.4,29 c4.7,0,5.9-3.437,5.7-3.937c-1.2-3-4.993-11.862-4.993-11.862s-0.6-1.1,0.8-1.4c1.4-0.3,3.8-0.7,3.8-0.7s1.105-0.163,1.6,0.8 c0.738,1.437,5.193,11.262,5.193,11.262s1.1,2.9,3.3,2.9c0.464,0,0.834-0.046,1.152-0.104c-0.082,1.635-0.348,3.221-0.817,4.722 C42.541,30.867,41.756,30.963,40.5,30.963z\" fill=\"currentColor\"/>\n                </svg>\n\n                <span>#{full_torrents}</span>\n            </div>\n\n            <div class=\"full-start__button selector view--trailer\">\n                <svg height=\"70\" viewBox=\"0 0 80 70\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                    <path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M71.2555 2.08955C74.6975 3.2397 77.4083 6.62804 78.3283 10.9306C80 18.7291 80 35 80 35C80 35 80 51.2709 78.3283 59.0694C77.4083 63.372 74.6975 66.7603 71.2555 67.9104C65.0167 70 40 70 40 70C40 70 14.9833 70 8.74453 67.9104C5.3025 66.7603 2.59172 63.372 1.67172 59.0694C0 51.2709 0 35 0 35C0 35 0 18.7291 1.67172 10.9306C2.59172 6.62804 5.3025 3.2395 8.74453 2.08955C14.9833 0 40 0 40 0C40 0 65.0167 0 71.2555 2.08955ZM55.5909 35.0004L29.9773 49.5714V20.4286L55.5909 35.0004Z\" fill=\"currentColor\"></path>\n                </svg>\n\n                <span>#{full_trailers}</span>\n            </div>\n        </div>\n    </div>");

    // CSS (оригинал)
    var style = "\n        <style>\n        .cardify{-webkit-transition:all .3s;-o-transition:all .3s;-moz-transition:all .3s;transition:all .3s}.cardify .full-start-new__body{height:80vh}.cardify .full-start-new__right{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:end;-webkit-align-items:flex-end;-moz-box-align:end;-ms-flex-align:end;align-items:flex-end}.cardify .full-start-new__title{text-shadow:0 0 .1em rgba(0,0,0,0.3)}.cardify__left{-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1}.cardify__right{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;position:relative}.cardify__details{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}.cardify .full-start-new__reactions{margin:0;margin-right:-2.8em}.cardify .full-start-new__reactions:not(.focus){margin:0}.cardify .full-start-new__reactions:not(.focus)>div:not(:first-child){display:none}.cardify .full-start-new__reactions:not(.focus) .reaction{position:relative}.cardify .full-start-new__reactions:not(.focus) .reaction__count{position:absolute;top:28%;left:95%;font-size:1.2em;font-weight:500}.cardify .full-start-new__rate-line{margin:0;margin-left:3.5em}.cardify .full-start-new__rate-line>*:last-child{margin-right:0 !important}.cardify__background{left:0}.cardify__background.loaded:not(.dim){opacity:1}.cardify__background.nodisplay{opacity:0 !important}.cardify.nodisplay{-webkit-transform:translate3d(0,50%,0);-moz-transform:translate3d(0,50%,0);transform:translate3d(0,50%,0);opacity:0}.head.nodisplay{-webkit-transform:translate3d(0,-100%,0);-moz-transform:translate3d(0,-100%,0);transform:translate3d(0,-100%,0)}body:not(.menu--open) .cardify__background{-webkit-mask-image:-webkit-gradient(linear,left top,left bottom,color-stop(50%,white),to(rgba(255,255,255,0)));-webkit-mask-image:-webkit-linear-gradient(top,white 50%,rgba(255,255,255,0) 100%);mask-image:-webkit-gradient(linear,left top,left bottom,color-stop(50%,white),to(rgba(255,255,255,0)));mask-image:linear-gradient(to bottom,white 50%,rgba(255,255,255,0) 100%)}\n        </style>\n    ";
    Lampa.Template.add('cardify_css', style);
    $('body').append(Lampa.Template.get('cardify_css', {}, true));

    // Добавляем ТОЛЬКО стили фон-видео (минимально, не ломаем разметку)
    addOnceStyle('cardify_bgtrailer_css_addon',
      ".cardify-bgtrailer{opacity:0;transition:opacity .25s;pointer-events:none;position:absolute;top:-60%;bottom:-60%;left:0;width:100%;display:flex;align-items:center;z-index:0}" +
      ".cardify-bgtrailer.display{opacity:1}" +
      ".cardify-bgtrailer iframe{border:0;width:100%;flex-shrink:0}" +
      ".full-start__background{overflow:hidden}" +
      ".full-start__background.cardify-bgtrailer--on{background-image:none!important}" +
      ".full-start__background.cardify-bgtrailer--on>img{opacity:0!important;transition:opacity .2s}"
    );

    // Settings (оригинал)
    var icon = "<svg width=\"36\" height=\"28\" viewBox=\"0 0 36 28\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n        <rect x=\"1.5\" y=\"1.5\" width=\"33\" height=\"25\" rx=\"3.5\" stroke=\"white\" stroke-width=\"3\"/>\n        <rect x=\"5\" y=\"14\" width=\"17\" height=\"4\" rx=\"2\" fill=\"white\"/>\n        <rect x=\"5\" y=\"20\" width=\"10\" height=\"3\" rx=\"1.5\" fill=\"white\"/>\n        <rect x=\"25\" y=\"20\" width=\"6\" height=\"3\" rx=\"1.5\" fill=\"white\"/>\n    </svg>";
    Lampa.SettingsApi.addComponent({ component: 'cardify', icon: icon, name: 'Cardify' });
    Lampa.SettingsApi.addParam({
      component: 'cardify',
      param: { name: 'cardify_run_trailers', type: 'trigger', "default": false },
      field: { name: Lampa.Lang.translate('cardify_enable_trailer') }
    });

    function startForObject(e) {
      if (!e || !e.object || !e.object.activity) return;
      if (e.object.activity.trailer_ready) return;

      // включено ли в настройках
      if (!Lampa.Storage.field('cardify_run_trailers')) return;

      // класс на фон как в ориге
      try { e.object.activity.render().find('.full-start__background').addClass('cardify__background'); } catch (err) {}

      var trailer = pickTrailer(e.data);
      if (!trailer) return;

      // версии
      try {
        if (Lampa.Manifest && Lampa.Manifest.app_digital && Lampa.Manifest.app_digital < 220) return;
      } catch (err2) {}

      // если карточка активна — стартуем сразу, иначе ждём start активности
      if (Lampa.Activity.active().activity === e.object.activity) {
        new BgTrailer(e.object, trailer);
      } else {
        var follow = function (a) {
          if (a.type == 'start' && a.object.activity === e.object.activity && !e.object.activity.trailer_ready) {
            Lampa.Listener.remove('activity', follow);
            new BgTrailer(e.object, trailer);
          }
        };
        Lampa.Listener.follow('activity', follow);
      }
    }

    // Хук на full complite (как было)
    Lampa.Listener.follow('full', function (e) {
      if (!e) return;
      if (e.type === 'complite' || e.type === 'complete') startForObject(e);
    });
  }

  // start
  if (window['app' + 're' + 'ady']) startPlugin();
  else {
    Lampa.Listener.follow('app', function (e) {
      if (e && e.type === 'ready') startPlugin();
    });
  }

})();
