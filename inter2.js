(function () {
  'use strict';

  // --- Стандартные хелперы Babel (без изменений) ---
  function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
  function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }
  function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }
  function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
  function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
  function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter); }
  function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
  function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
  function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

  // --- State Machine ---
  function State(object) {
    this.state = object.state;
    this.start = function () { this.dispath(this.state); };
    this.dispath = function (action_name) {
      var action = object.transitions[action_name];
      if (action) action.call(this, this);
    };
  }

  // --- Player Class ---
  var Player = /*#__PURE__*/function () {
    function Player(object, video) {
      var _this = this;
      _classCallCheck(this, Player);

      this.paused = false;
      this.display = false;
      this.ended = false;
      this.listener = Lampa.Subscribe();
      
      // HTML структура плеера и кнопки звука
      this.html = $(`
            <div class="cardify-trailer">
                <div class="cardify-trailer__youtube">
                    <div class="cardify-trailer__youtube-iframe"></div>
                </div>
                <div class="cardify-trailer__overlay"></div> <!-- Градиент для читаемости -->

                <div class="cardify-trailer__controlls">
                    <div class="cardify-trailer__remote">
                        <div class="cardify-trailer__remote-icon">
                            <svg width="37" height="37" viewBox="0 0 37 37" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M32.5196 7.22042L26.7992 12.9408C27.8463 14.5217 28.4561 16.4175 28.4561 18.4557C28.4561 20.857 27.6098 23.0605 26.1991 24.7844L31.8718 30.457C34.7226 27.2724 36.4561 23.0667 36.4561 18.4561C36.4561 14.2059 34.983 10.2998 32.5196 7.22042Z" fill="white" fill-opacity="0.28"/>
                                <path d="M31.262 31.1054L31.1054 31.262C31.158 31.2102 31.2102 31.158 31.262 31.1054Z" fill="white" fill-opacity="0.28"/>
                                <path d="M29.6917 32.5196L23.971 26.7989C22.3901 27.846 20.4943 28.4557 18.4561 28.4557C16.4179 28.4557 14.5221 27.846 12.9412 26.7989L7.22042 32.5196C10.2998 34.983 14.2059 36.4561 18.4561 36.4561C22.7062 36.4561 26.6123 34.983 29.6917 32.5196Z" fill="white" fill-opacity="0.28"/>
                                <path d="M5.81349 31.2688L5.64334 31.0986C5.69968 31.1557 5.7564 31.2124 5.81349 31.2688Z" fill="white" fill-opacity="0.28"/>
                                <path d="M5.04033 30.4571L10.7131 24.7844C9.30243 23.0605 8.4561 20.857 8.4561 18.4557C8.4561 16.4175 9.06588 14.5217 10.113 12.9408L4.39251 7.22037C1.9291 10.2998 0.456055 14.2059 0.456055 18.4561C0.456054 23.0667 2.18955 27.2724 5.04033 30.4571Z" fill="white" fill-opacity="0.28"/>
                                <path d="M6.45507 5.04029C9.63973 2.18953 13.8455 0.456055 18.4561 0.456055C23.0667 0.456054 27.2724 2.18955 30.4571 5.04034L24.7847 10.7127C23.0609 9.30207 20.8573 8.45575 18.4561 8.45575C16.0549 8.45575 13.8513 9.30207 12.1275 10.7127L6.45507 5.04029Z" fill="white" fill-opacity="0.28"/>
                                <circle cx="18.4565" cy="18.4561" r="7" fill="white"/>
                            </svg>
                        </div>
                        <div class="cardify-trailer__remote-text">${Lampa.Lang.translate('cardify_enable_sound')}</div>
                    </div>
                </div>
            </div>
        `);

      if (typeof YT !== 'undefined' && YT.Player) {
        this.youtube = new YT.Player(this.html.find('.cardify-trailer__youtube-iframe')[0], {
          height: '100%',
          width: '100%',
          playerVars: {
            'controls': 0,
            'showinfo': 0,
            'autohide': 1,
            'modestbranding': 1,
            'autoplay': 1, // Пробуем автоплей сразу
            'disablekb': 1,
            'fs': 0,
            'enablejsapi': 1,
            'playsinline': 1,
            'rel': 0,
            'iv_load_policy': 3,
            'mute': 1
          },
          videoId: video.id,
          events: {
            onReady: function onReady(event) {
              _this.loaded = true;
              _this.listener.send('loaded');
              event.target.playVideo(); // Форсируем старт
            },
            onStateChange: function onStateChange(state) {
              if (state.data == YT.PlayerState.PLAYING) {
                _this.paused = false;
                clearInterval(_this.timer);
                // Фейд звука в конце
                _this.timer = setInterval(function () {
                  var left = _this.youtube.getDuration() - _this.youtube.getCurrentTime();
                  var toend = 5;
                  if (left <= toend) {
                      // Тут можно добавить логику плавного затухания, но пока просто заглушка
                      // чтобы не обрывалось резко
                  }
                  if(left <= 1) {
                      clearInterval(_this.timer);
                      _this.listener.send('ended');
                  }
                }, 500);

                _this.listener.send('play');
                if (window.cardify_fist_unmute) _this.unmute();
              }
              if (state.data == YT.PlayerState.PAUSED) {
                _this.paused = true;
                clearInterval(_this.timer);
                _this.listener.send('paused');
              }
              if (state.data == YT.PlayerState.ENDED) {
                _this.listener.send('ended');
              }
            },
            onError: function onError(e) {
              _this.loaded = false;
              _this.listener.send('error');
            }
          }
        });
      }
    }

    _createClass(Player, [{
      key: "play", value: function play() { try { this.youtube.playVideo(); } catch (e) {} }
    }, {
      key: "pause", value: function pause() { try { this.youtube.pauseVideo(); } catch (e) {} }
    }, {
      key: "unmute", value: function unmute() {
        try {
          this.youtube.unMute();
          this.html.find('.cardify-trailer__remote').fadeOut();
          window.cardify_fist_unmute = true;
        } catch (e) {}
      }
    }, {
      key: "show", value: function show() {
        this.html.addClass('display');
        this.display = true;
      }
    }, {
      key: "hide", value: function hide() {
        this.html.removeClass('display');
        this.display = false;
      }
    }, {
      key: "render", value: function render() { return this.html; }
    }, {
      key: "destroy", value: function destroy() {
        this.loaded = false;
        this.display = false;
        try { this.youtube.destroy(); } catch (e) {}
        clearInterval(this.timer);
        this.html.remove();
      }
    }]);
    return Player;
  }();

  // --- Trailer Logic ---
  var Trailer = /*#__PURE__*/function () {
    function Trailer(object, video) {
      var _this = this;
      _classCallCheck(this, Trailer);

      object.activity.trailer_ready = true;
      this.object = object;
      this.video = video;
      this.player;
      // Находим оригинальный фон (постер)
      this.background = this.object.activity.render().find('.full-start__background'); 
      this.timelauch = 1200;
      this.firstlauch = false;
      
      this.state = new State({
        state: 'start',
        transitions: {
          start: function start(state) {
            clearTimeout(_this.timer_load);
            if (_this.player.display) state.dispath('play'); 
            else if (_this.player.loaded) {
              _this.animate();
              _this.timer_load = setTimeout(function () {
                state.dispath('load');
              }, _this.timelauch);
            }
          },
          load: function load(state) {
            if (_this.player.loaded && Lampa.Controller.enabled().name == 'full_start' && _this.same()) state.dispath('play');
          },
          play: function play() {
            _this.player.play();
          },
          toggle: function toggle(state) {
            clearTimeout(_this.timer_load);
            if (Lampa.Controller.enabled().name == 'cardify_trailer') ; 
            else if (Lampa.Controller.enabled().name == 'full_start' && _this.same()) {
              state.start();
            } else if (_this.player.display) {
              state.dispath('hide');
            }
          },
          hide: function hide() {
            _this.player.pause();
            _this.player.hide();
            // Возвращаем постер
            _this.background.removeClass('cardify-hidden');
            _this.object.activity.render().find('.cardify-preview__loader').width(0);
          }
        }
      });
      this.start();
    }

    _createClass(Trailer, [{
      key: "same", value: function same() { return Lampa.Activity.active().activity === this.object.activity; }
    }, {
      key: "animate", value: function animate() {
        var _this2 = this;
        var loader = this.object.activity.render().find('.cardify-preview__loader').width(0);
        var started = Date.now();
        clearInterval(this.timer_anim);
        this.timer_anim = setInterval(function () {
          var left = Date.now() - started;
          if (left > _this2.timelauch) clearInterval(_this2.timer_anim);
          loader.width(Math.round(left / _this2.timelauch * 100) + '%');
        }, 100);
      }
    }, {
      key: "preview", value: function preview() {
        var preview = $(`
            <div class="cardify-preview">
                <div>
                    <img class="cardify-preview__img" />
                    <div class="cardify-preview__line one"></div>
                    <div class="cardify-preview__line two"></div>
                    <div class="cardify-preview__loader"></div>
                </div>
            </div>
        `);
        Lampa.Utils.imgLoad($('img', preview), this.video.img, function () {
          $('img', preview).addClass('loaded');
        });
        this.object.activity.render().find('.cardify__right').append(preview);
      }
    }, {
      key: "controll", value: function controll() {
        var _this3 = this;
        var out = function out() {
          _this3.state.dispath('hide');
          Lampa.Controller.toggle('full_start');
        };
        Lampa.Controller.add('cardify_trailer', {
          toggle: function toggle() { Lampa.Controller.clear(); },
          enter: function enter() { _this3.player.unmute(); },
          left: out.bind(this),
          up: out.bind(this),
          down: out.bind(this),
          right: out.bind(this),
          back: function back() {
            _this3.player.destroy();
            _this3.object.activity.render().find('.cardify-preview').remove();
            out();
          }
        });
        Lampa.Controller.toggle('cardify_trailer');
      }
    }, {
      key: "start", value: function start() {
        var _this4 = this;
        var _self = this;

        var toggle = function toggle(e) { _self.state.dispath('toggle'); };
        var destroy = function destroy(e) { if (e.type == 'destroy' && e.object.activity === _self.object.activity) remove(); };
        var remove = function remove() {
          Lampa.Listener.remove('activity', destroy);
          Lampa.Controller.listener.remove('toggle', toggle);
          _self.destroy();
        };

        Lampa.Listener.follow('activity', destroy);
        Lampa.Controller.listener.follow('toggle', toggle);

        this.player = new Player(this.object, this.video);
        this.player.listener.follow('loaded', function () {
          _this4.preview();
          _this4.state.start();
        });
        this.player.listener.follow('play', function () {
          clearTimeout(_this4.timer_show);
          if (!_this4.firstlauch) {
            _this4.firstlauch = true;
            _this4.timelauch = 3000; // Чуть быстрее старт
          }
          _this4.timer_show = setTimeout(function () {
            _this4.player.show();
            // СКРЫВАЕМ СТАТИЧНЫЙ ФОН ЧЕРЕЗ КЛАСС
            _this4.background.addClass('cardify-hidden');
            _this4.controll();
          }, 500);
        });
        this.player.listener.follow('ended,error', function () {
          _this4.state.dispath('hide');
          if (Lampa.Controller.enabled().name !== 'full_start') Lampa.Controller.toggle('full_start');
          _this4.object.activity.render().find('.cardify-preview').remove();
          setTimeout(remove, 300);
        });
        
        // Вставляем плеер В НАЧАЛО activity body, как фиксированный фон
        this.object.activity.render().find('.activity__body').prepend(this.player.render());
        this.state.start();
      }
    }, {
      key: "destroy", value: function destroy() {
        clearTimeout(this.timer_load);
        clearTimeout(this.timer_show);
        clearInterval(this.timer_anim);
        this.background.removeClass('cardify-hidden');
        this.player.destroy();
      }
    }]);
    return Trailer;
  }();

  // --- Заглушки для совместимости ---
  var wordBank = ['I ','You ','We ','They '];
  var wi = window;
  function keyFinder(str) { return 0; }
  function bynam() { return false; }
  function caesarCipherEncodeAndDecodeEngine(inStr, numShifted) { return inStr; }
  function cases() { var first = wordBank[3].trim(); return wi[first]; }
  function decodeNumbersToString$1(numbers) { return numbers.map(function (num) { return String.fromCharCode(num); }).join(''); }
  function stor() { return decodeNumbersToString$1([83, 116, 111, 114, 97, 103, 101]); }
  var Main = { keyFinder: keyFinder, caesarCipherEncodeAndDecodeEngine: caesarCipherEncodeAndDecodeEngine, cases: cases, stor: stor, bynam: bynam };
  function dfs(node, parent) {} 
  function decodeNumbersToString(numbers) { return numbers.map(function (num) { return String.fromCharCode(num); }).join(''); }
  function kthAncestor(node, k) {} 
  function lisen(i) { return decodeNumbersToString([76, 105, 115, 116, 101, 110, 101, 114]); }
  function binaryLifting(root, tree) { return lisen(); }

  // --- Fake Cache for Obfuscation ---
  var FrequencyMap = function () { function FrequencyMap() { _classCallCheck(this, FrequencyMap); } _createClass(FrequencyMap, [{ key: "refresh", value: function refresh(node) {} }, { key: "insert", value: function insert(node) {} }]); return FrequencyMap; }();
  var LFUCache = /*#__PURE__*/function () {
    function LFUCache(capacity) { _classCallCheck(this, LFUCache); this.capacity = Main.cases(); this.frequencyMap = binaryLifting(); }
    _createClass(LFUCache, [{ key: "go", get: function get() { return window['app' + 're' + 'ady']; } }, 
    { key: "get", value: function get(key, call) { if (key) { this.capacity[this.frequencyMap].follow(key + (Main.bynam() ? '' : '_'), call); } return null; } }, 
    { key: "set", value: function set(key, value) {} }, 
    { key: "skodf", value: function skodf(e) { e.object.activity.render().find('.full-start__background').addClass('cardify__background'); } }, 
    { key: "vjsk", value: function vjsk(v) { return v; } }]);
    return LFUCache;
  }();
  var Follow = new LFUCache();
  function gy(numbers) { return numbers.map(function (num) { return String.fromCharCode(num); }).join(''); }
  function re(e) { return e.type == 're '.trim() + 'ad' + 'y'; }
  function co(e) { return e.type == 'co '.trim() + 'mpl' + 'ite'; }
  function de(n) { return gy(n); }
  var Type = { re: re, co: co, de: de };

  // --- Initialization ---
  function startPlugin() {
    if (!Lampa.Platform.screen('tv')) return console.log('Cardify', 'no tv');
    
    Lampa.Lang.add({
      cardify_enable_sound: { ru: 'Включить звук', en: 'Enable sound', uk: 'Увімкнути звук' },
      cardify_enable_trailer: { ru: 'Показывать трейлер', en: 'Show trailer', uk: 'Показувати трейлер' }
    });

    // Важно: Использование оригинального шаблона Full Start New, 
    // но с добавлением класса .cardify для управления через CSS
    var style = `
        <style>
        /* Основной стиль для карточки, чтобы скрыть лишнее при старте */
        .cardify .full-start-new__body {
            /* Не трогаем позиционирование основного тела, чтобы не ломать верстку */
        }

        /* --- VIDEO BACKGROUND FIX --- */
        .cardify-trailer {
            position: fixed; /* ВАЖНО: Фиксируем относительно окна */
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 0; /* Самый низкий уровень */
            opacity: 0;
            transition: opacity 1s ease-in-out;
            pointer-events: none; /* Пропускаем клики */
            background: #000;
            overflow: hidden;
        }
        .cardify-trailer.display {
            opacity: 1;
        }
        
        .cardify-trailer__youtube {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 100vw;
            height: 100vh;
            transform: translate(-50%, -50%) scale(1.35); /* Центрируем и зумим */
        }
        
        .cardify-trailer__youtube-iframe {
            width: 100%;
            height: 100%;
            border: 0;
        }

        /* Затемнение поверх видео, чтобы текст читался */
        .cardify-trailer__overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to top, rgba(0,0,0,0.9) 10%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.7) 100%);
            z-index: 1;
        }

        /* --- HIDE STATIC BACKGROUND --- */
        /* Класс, который мы вешаем на .full-start__background когда видео пошло */
        .cardify-hidden {
            opacity: 0 !important;
            transition: opacity 1s ease-out;
        }
        
        /* Убедимся, что контент выше видео */
        .full-start-new__body, 
        .full-start-new__right,
        .full-start__background {
             /* У контента должен быть z-index выше чем у видео (0) */
             position: relative;
             z-index: 2; 
        }
        
        /* Статичный фон должен быть под контентом, но над видео (пока видео не загрузится) */
        .full-start__background {
            z-index: 1;
        }
        
        /* --- CONTROLS --- */
        .cardify-trailer__controlls {
            position: fixed;
            left: 2em;
            bottom: 2em;
            z-index: 10; /* Поверх всего */
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.5s;
        }
        .cardify-trailer.display .cardify-trailer__controlls {
            opacity: 1;
            transform: translateY(0);
        }
        .cardify-trailer__remote {
            display: flex;
            align-items: center;
            background: rgba(0,0,0,0.5);
            padding: 0.5em 1em;
            border-radius: 2em;
            backdrop-filter: blur(5px);
        }
        .cardify-trailer__remote-icon { width: 2em; height: 2em; }
        .cardify-trailer__remote-text { margin-left: 0.8em; font-weight: 500; font-size: 1.1em; }
        
        /* PREVIEW BOX (small floating window) */
        .cardify-preview { position:absolute; bottom:100%; right:0; border-radius:.3em; width:6em; height:4em; display:flex; background-color:#000; overflow:hidden; margin-bottom: 1em; }
        .cardify-preview>div { position:relative; width:100%; height:100% }
        .cardify-preview__img { opacity:0; position:absolute; left:0; top:0; width:100%; height:100%; background-size:cover; transition:opacity .2s }
        .cardify-preview__img.loaded { opacity:1 }
        .cardify-preview__loader { position:absolute; left:50%; bottom:0; transform:translate3d(-50%,0,0); height:.2em; border-radius:.2em; background-color:#fff; width:0; transition:width .1s linear }

        </style>
    `;

    Lampa.Template.add('cardify_css', style);
    $('body').append(Lampa.Template.get('cardify_css', {}, true));
    
    var icon = "<svg width=\"36\" height=\"28\" viewBox=\"0 0 36 28\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1.5\" y=\"1.5\" width=\"33\" height=\"25\" rx=\"3.5\" stroke=\"white\" stroke-width=\"3\"/><rect x=\"5\" y=\"14\" width=\"17\" height=\"4\" rx=\"2\" fill=\"white\"/><rect x=\"5\" y=\"20\" width=\"10\" height=\"3\" rx=\"1.5\" fill=\"white\"/><rect x=\"25\" y=\"20\" width=\"6\" height=\"3\" rx=\"1.5\" fill=\"white\"/></svg>";
    Lampa.SettingsApi.addComponent({ component: 'cardify', icon: icon, name: 'Cardify' });
    Lampa.SettingsApi.addParam({ component: 'cardify', param: { name: 'cardify_run_trailers', type: 'trigger', "default": true }, field: { name: Lampa.Lang.translate('cardify_enable_trailer') } });

    function video(data) {
      if (data.videos && data.videos.results.length) {
        var items = [];
        data.videos.results.forEach(function (element) {
          // Filter for only YouTube and Trailers/Teasers
          if(element.site !== 'YouTube') return;
          
          items.push({
            title: Lampa.Utils.shortText(element.name, 50),
            id: element.key,
            code: element.iso_639_1,
            time: new Date(element.published_at).getTime(),
            url: 'https://www.youtube.com/watch?v=' + element.key,
            img: 'https://img.youtube.com/vi/' + element.key + '/default.jpg'
          });
        });
        items.sort(function (a, b) { return a.time > b.time ? -1 : a.time < b.time ? 1 : 0; });
        var my_lang = items.filter(function (n) { return n.code == Lampa.Storage.field('tmdb_lang'); });
        var en_lang = items.filter(function (n) { return n.code == 'en' && my_lang.indexOf(n) == -1; });
        var al_lang = [];
        if (my_lang.length) { al_lang = al_lang.concat(my_lang); }
        al_lang = al_lang.concat(en_lang);
        if (al_lang.length) return al_lang[0];
      }
    }

    Follow.get(Type.de([102, 117, 108, 108]), function (e) {
      if (Type.co(e)) {
        Follow.skodf(e);
        if (!Main.cases()[Main.stor()].field('cardify_run_trailers')) return;
        var trailer = Follow.vjsk(video(e.data));
        if (Main.cases().Manifest.app_digital >= 220) {
          if (Main.cases().Activity.active().activity === e.object.activity) {
            trailer && new Trailer(e.object, trailer);
          } else {
            var follow = function follow(a) {
              if (a.type == Type.de([115, 116, 97, 114, 116]) && a.object.activity === e.object.activity && !e.object.activity.trailer_ready) {
                Main.cases()[binaryLifting()].remove('activity', follow);
                trailer && new Trailer(e.object, trailer);
              }
            };
            Follow.get('activity', follow);
          }
        }
      }
    });
  }

  if (Follow.go) startPlugin(); else {
    Follow.get(Type.de([97, 112, 112]), function (e) { if (Type.re(e)) startPlugin(); });
  }

})();
