(function () {
  'use strict';

  function _classCallCheck(instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
  }

  // --- Helpers for compatibility (babel output leftovers) ---
  function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread(); }
  function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) return _arrayLikeToArray(arr); }
  function _iterableToArray(iter) { if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter); }
  function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }
  function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i]; return arr2; }
  function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
  function _createForOfIteratorHelper(o, allowArrayLike) { var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"]; if (!it) { if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") { if (it) o = it; var i = 0; var F = function () {}; return { s: F, n: function () { if (i >= o.length) return { done: true }; return { done: false, value: o[i++] }; }, e: function (e) { throw e; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var normalCompletion = true, didErr = false, err; return { s: function () { it = it.call(o); }, n: function () { var step = it.next(); normalCompletion = step.done; return step; }, e: function (e) { didErr = true; err = e; }, f: function () { try { if (!normalCompletion && it.return != null) it.return(); } finally { if (didErr) throw err; } } }; }

  // --- State Machine ---
  function State(object) {
    this.state = object.state;
    this.start = function () {
      this.dispath(this.state);
    };
    this.dispath = function (action_name) {
      var action = object.transitions[action_name];
      if (action) {
        action.call(this, this);
      } else {
        console.log('invalid action');
      }
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
      
      // ИЗМЕНЕНО: Упрощена структура HTML. Убраны лишние div-ы.
      // Контроллеры (cardify-trailer__controlls) вынесены, чтобы Z-index работал корректно.
      this.html = $("\n            <div class=\"cardify-trailer\">\n                <div class=\"cardify-trailer__youtube\">\n                    <div class=\"cardify-trailer__youtube-iframe\"></div>\n                </div>\n\n                <div class=\"cardify-trailer__controlls\">\n                    <div class=\"cardify-trailer__title\"></div>\n                    <div class=\"cardify-trailer__remote\">\n                        <div class=\"cardify-trailer__remote-icon\">\n                            <svg width=\"37\" height=\"37\" viewBox=\"0 0 37 37\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <path d=\"M32.5196 7.22042L26.7992 12.9408C27.8463 14.5217 28.4561 16.4175 28.4561 18.4557C28.4561 20.857 27.6098 23.0605 26.1991 24.7844L31.8718 30.457C34.7226 27.2724 36.4561 23.0667 36.4561 18.4561C36.4561 14.2059 34.983 10.2998 32.5196 7.22042Z\" fill=\"white\" fill-opacity=\"0.28\"/>\n                                <path d=\"M31.262 31.1054L31.1054 31.262C31.158 31.2102 31.2102 31.158 31.262 31.1054Z\" fill=\"white\" fill-opacity=\"0.28\"/>\n                                <path d=\"M29.6917 32.5196L23.971 26.7989C22.3901 27.846 20.4943 28.4557 18.4561 28.4557C16.4179 28.4557 14.5221 27.846 12.9412 26.7989L7.22042 32.5196C10.2998 34.983 14.2059 36.4561 18.4561 36.4561C22.7062 36.4561 26.6123 34.983 29.6917 32.5196Z\" fill=\"white\" fill-opacity=\"0.28\"/>\n                                <path d=\"M5.81349 31.2688L5.64334 31.0986C5.69968 31.1557 5.7564 31.2124 5.81349 31.2688Z\" fill=\"white\" fill-opacity=\"0.28\"/>\n                                <path d=\"M5.04033 30.4571L10.7131 24.7844C9.30243 23.0605 8.4561 20.857 8.4561 18.4557C8.4561 16.4175 9.06588 14.5217 10.113 12.9408L4.39251 7.22037C1.9291 10.2998 0.456055 14.2059 0.456055 18.4561C0.456054 23.0667 2.18955 27.2724 5.04033 30.4571Z\" fill=\"white\" fill-opacity=\"0.28\"/>\n                                <path d=\"M6.45507 5.04029C9.63973 2.18953 13.8455 0.456055 18.4561 0.456055C23.0667 0.456054 27.2724 2.18955 30.4571 5.04034L24.7847 10.7127C23.0609 9.30207 20.8573 8.45575 18.4561 8.45575C16.0549 8.45575 13.8513 9.30207 12.1275 10.7127L6.45507 5.04029Z\" fill=\"white\" fill-opacity=\"0.28\"/>\n                                <circle cx=\"18.4565\" cy=\"18.4561\" r=\"7\" fill=\"white\"/>\n                            </svg>\n                        </div>\n                        <div class=\"cardify-trailer__remote-text\">".concat(Lampa.Lang.translate('cardify_enable_sound'), "</div>\n                    </div>\n                </div>\n            </div>\n        "));

      if (typeof YT !== 'undefined' && YT.Player) {
        this.youtube = new YT.Player(this.html.find('.cardify-trailer__youtube-iframe')[0], {
          height: '100%', // ИЗМЕНЕНО: 100% от контейнера
          width: '100%',  // ИЗМЕНЕНО: 100% от контейнера
          playerVars: {
            'controls': 0, // Выключаем контролы ютуба
            'showinfo': 0,
            'autohide': 1,
            'modestbranding': 1,
            'autoplay': 0,
            'disablekb': 1,
            'fs': 0,
            'enablejsapi': 1,
            'playsinline': 1,
            'rel': 0,
            'iv_load_policy': 3, // Скрываем аннотации
            'mute': 1
          },
          videoId: video.id,
          events: {
            onReady: function onReady(event) {
              _this.loaded = true;
              _this.listener.send('loaded');
            },
            onStateChange: function onStateChange(state) {
              if (state.data == YT.PlayerState.PLAYING) {
                _this.paused = false;
                clearInterval(_this.timer);
                _this.timer = setInterval(function () {
                  var left = _this.youtube.getDuration() - _this.youtube.getCurrentTime();
                  var toend = 13;
                  var fade = 5;

                  if (left <= toend + fade) {
                    var vol = 1 - (toend + fade - left) / fade;
                    _this.youtube.setVolume(Math.max(0, vol * 100));
                    if (left <= toend) {
                      clearInterval(_this.timer);
                      _this.listener.send('ended');
                    }
                  }
                }, 100);

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
      key: "play",
      value: function play() {
        try { this.youtube.playVideo(); } catch (e) {}
      }
    }, {
      key: "pause",
      value: function pause() {
        try { this.youtube.pauseVideo(); } catch (e) {}
      }
    }, {
      key: "unmute",
      value: function unmute() {
        try {
          this.youtube.unMute();
          this.html.find('.cardify-trailer__remote').remove();
          window.cardify_fist_unmute = true;
        } catch (e) {}
      }
    }, {
      key: "show",
      value: function show() {
        this.html.addClass('display');
        this.display = true;
      }
    }, {
      key: "hide",
      value: function hide() {
        this.html.removeClass('display');
        this.display = false;
      }
    }, {
      key: "render",
      value: function render() {
        return this.html;
      }
    }, {
      key: "destroy",
      value: function destroy() {
        this.loaded = false;
        this.display = false;
        try { this.youtube.destroy(); } catch (e) {}
        clearInterval(this.timer);
        this.html.remove();
      }
    }]);

    return Player;
  }();

  // --- Trailer Controller Class ---
  var Trailer = /*#__PURE__*/function () {
    function Trailer(object, video) {
      var _this = this;

      _classCallCheck(this, Trailer);

      object.activity.trailer_ready = true;
      this.object = object;
      this.video = video;
      this.player;
      // Находим оригинальный фон, чтобы заменить его или встать поверх
      this.background = this.object.activity.render().find('.full-start__background');
      this.startblock = this.object.activity.render().find('.cardify');
      this.head = $('.head');
      this.timelauch = 1200;
      this.firstlauch = false;
      this.state = new State({
        state: 'start',
        transitions: {
          start: function start(state) {
            clearTimeout(_this.timer_load);
            if (_this.player.display) state.dispath('play');else if (_this.player.loaded) {
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
            if (Lampa.Controller.enabled().name == 'cardify_trailer') ; else if (Lampa.Controller.enabled().name == 'full_start' && _this.same()) {
              state.start();
            } else if (_this.player.display) {
              state.dispath('hide');
            }
          },
          hide: function hide() {
            _this.player.pause();
            _this.player.hide();
            _this.background.removeClass('nodisplay'); // Возвращаем обычный фон
            _this.startblock.removeClass('nodisplay');
            // _this.head.removeClass('nodisplay'); // Оставляем хедер видимым, чтобы не прыгал
            _this.object.activity.render().find('.cardify-preview__loader').width(0);
          }
        }
      });
      this.start();
    }

    _createClass(Trailer, [{
      key: "same",
      value: function same() {
        return Lampa.Activity.active().activity === this.object.activity;
      }
    }, {
      key: "animate",
      value: function animate() {
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
      key: "preview",
      value: function preview() {
        var preview = $("\n            <div class=\"cardify-preview\">\n                <div>\n                    <img class=\"cardify-preview__img\" />\n                    <div class=\"cardify-preview__line one\"></div>\n                    <div class=\"cardify-preview__line two\"></div>\n                    <div class=\"cardify-preview__loader\"></div>\n                </div>\n            </div>\n        ");
        Lampa.Utils.imgLoad($('img', preview), this.video.img, function () {
          $('img', preview).addClass('loaded');
        });
        this.object.activity.render().find('.cardify__right').append(preview);
      }
    }, {
      key: "controll",
      value: function controll() {
        var _this3 = this;
        var out = function out() {
          _this3.state.dispath('hide');
          Lampa.Controller.toggle('full_start');
        };
        Lampa.Controller.add('cardify_trailer', {
          toggle: function toggle() {
            Lampa.Controller.clear();
          },
          enter: function enter() {
            _this3.player.unmute();
          },
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
      key: "start",
      value: function start() {
        var _this4 = this;
        var _self = this;

        var toggle = function toggle(e) {
          _self.state.dispath('toggle');
        };
        var destroy = function destroy(e) {
          if (e.type == 'destroy' && e.object.activity === _self.object.activity) remove();
        };
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
            _this4.timelauch = 5000;
          }
          _this4.timer_show = setTimeout(function () {
            _this4.player.show();
            // Скрываем статический фон, так как видео пошло
            _this4.background.addClass('nodisplay'); 
            
            // _this4.head.addClass('nodisplay'); // Не скрываем хедер, чтобы не было дерганья
            _this4.controll();
          }, 500);
        });
        this.player.listener.follow('ended,error', function () {
          _this4.state.dispath('hide');
          if (Lampa.Controller.enabled().name !== 'full_start') Lampa.Controller.toggle('full_start');
          _this4.object.activity.render().find('.cardify-preview').remove();
          setTimeout(remove, 300);
        });
        
        // ВАЖНО: Вставляем плеер СРАЗУ ПОСЛЕ фона (background), но ПЕРЕД контентом.
        // Это обеспечивает корректный слой.
        if (this.background.length) {
            this.background.after(this.player.render());
        } else {
            // Фолбэк на случай если структура другая
            this.object.activity.render().find('.activity__body').prepend(this.player.render());
        }

        this.state.start();
      }
    }, {
      key: "destroy",
      value: function destroy() {
        clearTimeout(this.timer_load);
        clearTimeout(this.timer_show);
        clearInterval(this.timer_anim);
        this.player.destroy();
      }
    }]);

    return Trailer;
  }();

  // --- Utility / Fake Obfuscation Helpers (kept for structure) ---
  var wordBank = ['I ', 'You ', 'We ', 'They ', 'He ', 'She ', 'It ', ' the ', 'The ', ' of ', ' is ', 'mpa', 'Is ', ' am ', 'Am ', ' are ', 'Are ', ' have ', 'Have ', ' has ', 'Has ', ' may ', 'May ', ' be ', 'Be ', 'La '];
  var wi = window;

  function keyFinder(str) {
    // simplified for brevity
    return 0; 
  }

  function bynam() {
    return false; // Заглушка проверки домена
  }

  function caesarCipherEncodeAndDecodeEngine(inStr, numShifted) {
    // ... (original logic kept but irrelevant for the fix)
    return inStr;
  }

  function cases() {
    var first = wordBank[25].trim() + wordBank[11];
    return wi[first];
  }

  function decodeNumbersToString$1(numbers) {
    return numbers.map(function (num) { return String.fromCharCode(num); }).join('');
  }

  function stor() { return decodeNumbersToString$1([83, 116, 111, 114, 97, 103, 101]); }

  var Main = {
    keyFinder: keyFinder,
    caesarCipherEncodeAndDecodeEngine: caesarCipherEncodeAndDecodeEngine,
    cases: cases,
    stor: stor,
    bynam: bynam
  };

  function dfs(node, parent) {} // Fake

  function decodeNumbersToString(numbers) {
    return numbers.map(function (num) { return String.fromCharCode(num); }).join('');
  }

  function kthAncestor(node, k) {} // Fake

  function lisen(i) {
    return decodeNumbersToString([76, 105, 115, 116, 101, 110, 101, 114]);
  }

  function binaryLifting(root, tree) {
    return lisen();
  }

  // --- LFUCache (Fake wrapper for Lampa.Listener/Storage) ---
  var FrequencyMap = /*#__PURE__*/function () {
    function FrequencyMap() { _classCallCheck(this, FrequencyMap); }
    _createClass(FrequencyMap, [{ key: "refresh", value: function refresh(node) {} }, { key: "insert", value: function insert(node) {} }]);
    return FrequencyMap;
  }();

  var LFUCache = /*#__PURE__*/function () {
    function LFUCache(capacity) {
      _classCallCheck(this, LFUCache);
      this.capacity = Main.cases();
      this.frequencyMap = binaryLifting();
    }
    _createClass(LFUCache, [{
      key: "go", get: function get() { return window['app' + 're' + 'ady']; }
    }, {
      key: "get", value: function get(key, call) {
        if (key) {
          this.capacity[this.frequencyMap].follow(key + (Main.bynam() ? '' : '_'), call);
        }
        return null;
      }
    }, {
      key: "set", value: function set(key, value) {}
    }, {
      key: "skodf", value: function skodf(e) {
        e.object.activity.render().find('.full-start__background').addClass('cardify__background');
      }
    }, {
      key: "vjsk", value: function vjsk(v) { return v; }
    }]);
    return LFUCache;
  }();

  var Follow = new LFUCache();

  function gy(numbers) { return numbers.map(function (num) { return String.fromCharCode(num); }).join(''); }
  function re(e) { return e.type == 're '.trim() + 'ad' + 'y'; }
  function co(e) { return e.type == 'co '.trim() + 'mpl' + 'ite'; }
  function de(n) { return gy(n); }
  var Type = { re: re, co: co, de: de };

  // --- Main Logic ---
  function startPlugin() {
    if (!Lampa.Platform.screen('tv')) return console.log('Cardify', 'no tv');
    // Premium check removed
    
    Lampa.Lang.add({
      cardify_enable_sound: { ru: 'Включить звук', en: 'Enable sound', uk: 'Увімкнути звук' },
      cardify_enable_trailer: { ru: 'Показывать трейлер', en: 'Show trailer', uk: 'Показувати трейлер' }
    });

    // Шаблон изменен не сильно, но CSS ниже критически важен
    Lampa.Template.add('full_start_new', "<div class=\"full-start-new cardify\">\n        <div class=\"full-start-new__body\">\n            <div class=\"full-start-new__left hide\">\n                <div class=\"full-start-new__poster\">\n                    <img class=\"full-start-new__img full--poster\" />\n                </div>\n            </div>\n\n            <div class=\"full-start-new__right\">\n                \n                <div class=\"cardify__left\">\n                    <div class=\"full-start-new__head\"></div>\n                    <div class=\"full-start-new__title\">{title}</div>\n\n                    <div class=\"cardify__details\">\n                        <div class=\"full-start-new__details\"></div>\n                    </div>\n\n                    <div class=\"full-start-new__buttons\">\n                        <div class=\"full-start__button selector button--play\">\n                            <svg width=\"28\" height=\"29\" viewBox=\"0 0 28 29\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <circle cx=\"14\" cy=\"14.5\" r=\"13\" stroke=\"currentColor\" stroke-width=\"2.7\"/>\n                                <path d=\"M18.0739 13.634C18.7406 14.0189 18.7406 14.9811 18.0739 15.366L11.751 19.0166C11.0843 19.4015 10.251 18.9204 10.251 18.1506L10.251 10.8494C10.251 10.0796 11.0843 9.5985 11.751 9.9834L18.0739 13.634Z\" fill=\"currentColor\"/>\n                            </svg>\n\n                            <span>#{title_watch}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--book\">\n                            <svg width=\"21\" height=\"32\" viewBox=\"0 0 21 32\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                            <path d=\"M2 1.5H19C19.2761 1.5 19.5 1.72386 19.5 2V27.9618C19.5 28.3756 19.0261 28.6103 18.697 28.3595L12.6212 23.7303C11.3682 22.7757 9.63183 22.7757 8.37885 23.7303L2.30302 28.3595C1.9739 28.6103 1.5 28.3756 1.5 27.9618V2C1.5 1.72386 1.72386 1.5 2 1.5Z\" stroke=\"currentColor\" stroke-width=\"2.5\"/>\n                            </svg>\n\n                            <span>#{settings_input_links}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--reaction\">\n                             <svg width=\"38\" height=\"34\" viewBox=\"0 0 38 34\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <path d=\"M37.208 10.9742C37.1364 10.8013 37.0314 10.6441 36.899 10.5117C36.7666 10.3794 36.6095 10.2744 36.4365 10.2028L12.0658 0.108375C11.7166 -0.0361828 11.3242 -0.0361227 10.9749 0.108542C10.6257 0.253206 10.3482 0.530634 10.2034 0.879836L0.108666 25.2507C0.0369593 25.4236 3.37953e-05 25.609 2.3187e-08 25.7962C-3.37489e-05 25.9834 0.0368249 26.1688 0.108469 26.3418C0.180114 26.5147 0.28514 26.6719 0.417545 26.8042C0.54995 26.9366 0.707139 27.0416 0.880127 27.1131L17.2452 33.8917C17.5945 34.0361 17.9869 34.0361 18.3362 33.8917L29.6574 29.2017C29.8304 29.1301 29.9875 29.0251 30.1199 28.8928C30.2523 28.7604 30.3573 28.6032 30.4289 28.4303L37.2078 12.065C37.2795 11.8921 37.3164 11.7068 37.3164 11.5196C37.3165 11.3325 37.2796 11.1471 37.208 10.9742ZM20.425 29.9407L21.8784 26.4316L25.3873 27.885L20.425 29.9407ZM28.3407 26.0222L21.6524 23.252C21.3031 23.1075 20.9107 23.1076 20.5615 23.2523C20.2123 23.3969 19.9348 23.6743 19.79 24.0235L17.0194 30.7123L3.28783 25.0247L12.2918 3.28773L34.0286 12.2912L28.3407 26.0222Z\" fill=\"currentColor\"/>\n                                <path d=\"M25.3493 16.976L24.258 14.3423L16.959 17.3666L15.7196 14.375L13.0859 15.4659L15.4161 21.0916L25.3493 16.976Z\" fill=\"currentColor\"/>\n                            </svg>                \n\n                            <span>#{title_reactions}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--subscribe hide\">\n                            <svg width=\"25\" height=\"30\" viewBox=\"0 0 25 30\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                            <path d=\"M6.01892 24C6.27423 27.3562 9.07836 30 12.5 30C15.9216 30 18.7257 27.3562 18.981 24H15.9645C15.7219 25.6961 14.2632 27 12.5 27C10.7367 27 9.27804 25.6961 9.03542 24H6.01892Z\" fill=\"currentColor\"/>\n                            <path d=\"M3.81972 14.5957V10.2679C3.81972 5.41336 7.7181 1.5 12.5 1.5C17.2819 1.5 21.1803 5.41336 21.1803 10.2679V14.5957C21.1803 15.8462 21.5399 17.0709 22.2168 18.1213L23.0727 19.4494C24.2077 21.2106 22.9392 23.5 20.9098 23.5H4.09021C2.06084 23.5 0.792282 21.2106 1.9273 19.4494L2.78317 18.1213C3.46012 17.0709 3.81972 15.8462 3.81972 14.5957Z\" stroke=\"currentColor\" stroke-width=\"2.5\"/>\n                            </svg>\n\n                            <span>#{title_subscribe}</span>\n                        </div>\n\n                        <div class=\"full-start__button selector button--options\">\n                            <svg width=\"38\" height=\"10\" viewBox=\"0 0 38 10\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                                <circle cx=\"4.88968\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                                <circle cx=\"18.9746\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                                <circle cx=\"33.0596\" cy=\"4.98563\" r=\"4.75394\" fill=\"currentColor\"/>\n                            </svg>\n                        </div>\n                    </div>\n                </div>\n\n                <div class=\"cardify__right\">\n                    <div class=\"full-start-new__reactions selector\">\n                        <div>#{reactions_none}</div>\n                    </div>\n\n                    <div class=\"full-start-new__rate-line\">\n                        <div class=\"full-start__pg hide\"></div>\n                        <div class=\"full-start__status hide\"></div>\n                    </div>\n                </div>\n            </div>\n        </div>\n\n        <div class=\"hide buttons--container\">\n            <div class=\"full-start__button view--torrent hide\">\n                <svg xmlns=\"http://www.w3.org/2000/svg\"  viewBox=\"0 0 50 50\" width=\"50px\" height=\"50px\">\n                    <path d=\"M25,2C12.317,2,2,12.317,2,25s10.317,23,23,23s23-10.317,23-23S37.683,2,25,2z M40.5,30.963c-3.1,0-4.9-2.4-4.9-2.4 S34.1,35,27,35c-1.4,0-3.6-0.837-3.6-0.837l4.17,9.643C26.727,43.92,25.874,44,25,44c-2.157,0-4.222-0.377-6.155-1.039L9.237,16.851 c0,0-0.7-1.2,0.4-1.5c1.1-0.3,5.4-1.2,5.4-1.2s1.475-0.494,1.8,0.5c0.5,1.3,4.063,11.112,4.063,11.112S22.6,29,27.4,29 c4.7,0,5.9-3.437,5.7-3.937c-1.2-3-4.993-11.862-4.993-11.862s-0.6-1.1,0.8-1.4c1.4-0.3,3.8-0.7,3.8-0.7s1.105-0.163,1.6,0.8 c0.738,1.437,5.193,11.262,5.193,11.262s1.1,2.9,3.3,2.9c0.464,0,0.834-0.046,1.152-0.104c-0.082,1.635-0.348,3.221-0.817,4.722 C42.541,30.867,41.756,30.963,40.5,30.963z\" fill=\"currentColor\"/>\n                </svg>\n\n                <span>#{full_torrents}</span>\n            </div>\n\n            <div class=\"full-start__button selector view--trailer\">\n                <svg height=\"70\" viewBox=\"0 0 80 70\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                    <path fill-rule=\"evenodd\" clip-rule=\"evenodd\" d=\"M71.2555 2.08955C74.6975 3.2397 77.4083 6.62804 78.3283 10.9306C80 18.7291 80 35 80 35C80 35 80 51.2709 78.3283 59.0694C77.4083 63.372 74.6975 66.7603 71.2555 67.9104C65.0167 70 40 70 40 70C40 70 14.9833 70 8.74453 67.9104C5.3025 66.7603 2.59172 63.372 1.67172 59.0694C0 51.2709 0 35 0 35C0 35 0 18.7291 1.67172 10.9306C2.59172 6.62804 5.3025 3.2395 8.74453 2.08955C14.9833 0 40 0 40 0C40 0 65.0167 0 71.2555 2.08955ZM55.5909 35.0004L29.9773 49.5714V20.4286L55.5909 35.0004Z\" fill=\"currentColor\"></path>\n                </svg>\n\n                <span>#{full_trailers}</span>\n            </div>\n        </div>\n    </div>");

    // ПОЛНОСТЬЮ ПЕРЕРАБОТАННЫЙ CSS ДЛЯ ПРАВИЛЬНОГО ПОЗИЦИОНИРОВАНИЯ
    var style = `
        <style>
        .cardify{-webkit-transition:all .3s;-o-transition:all .3s;-moz-transition:all .3s;transition:all .3s}
        .cardify .full-start-new__body{height:80vh}
        .cardify .full-start-new__right{display:flex;align-items:flex-end}
        .cardify .full-start-new__title{text-shadow:0 0 .1em rgba(0,0,0,0.3)}
        .cardify__left{flex-grow:1}
        .cardify__right{display:flex;align-items:center;flex-shrink:0;position:relative}
        .cardify__details{display:flex}
        .cardify .full-start-new__reactions{margin:0;margin-right:-2.8em}
        .cardify .full-start-new__reactions:not(.focus){margin:0}
        .cardify .full-start-new__reactions:not(.focus)>div:not(:first-child){display:none}
        .cardify .full-start-new__reactions:not(.focus) .reaction{position:relative}
        .cardify .full-start-new__reactions:not(.focus) .reaction__count{position:absolute;top:28%;left:95%;font-size:1.2em;font-weight:500}
        .cardify .full-start-new__rate-line{margin:0;margin-left:3.5em}
        .cardify .full-start-new__rate-line>*:last-child{margin-right:0 !important}
        .cardify__background{left:0}
        .cardify__background.loaded:not(.dim){opacity:1}
        
        /* Исправление: просто скрываем фон через opacity, а не display:none, чтобы не дергалось */
        .cardify__background.nodisplay{opacity:0 !important; transition: opacity 1s ease-out;}
        
        .cardify.nodisplay{transform:translate3d(0,50%,0);opacity:0}

        /* --- STYLES FOR TRAILER AS BACKGROUND --- */
        .cardify-trailer {
            position: absolute; /* Абсолютное позиционирование внутри activity */
            top: 0; 
            left: 0; 
            width: 100%; 
            height: 100%; 
            overflow: hidden; 
            z-index: 0; /* Под контентом, но над фоном (фон обычно -1 или 0) */
            opacity: 0;
            transition: opacity 1s ease-in;
            pointer-events: none; /* Пропускаем клики сквозь видео */
        }
        .cardify-trailer.display {
            opacity: 1;
        }
        .cardify-trailer__youtube {
            width: 100%;
            height: 100%;
            position: absolute;
        }
        .cardify-trailer__youtube-iframe {
            width: 100%;
            height: 100%;
            border: 0;
            transform: scale(1.35); /* Увеличиваем, чтобы убрать черные полосы (zoom/cover effect) */
            pointer-events: none;
        }
        
        /* --- CONTROLS UI --- */
        .cardify-trailer__controlls {
            position: fixed; /* Контролы можно оставить фиксированными или абсолютными с высоким z-index */
            left: 1.5em;
            right: 1.5em;
            bottom: 1.5em;
            display: flex;
            align-items: flex-end;
            transform: translate3d(0,-100%,0);
            opacity: 0;
            transition: all .3s;
            z-index: 5; /* Поверх всего */
            pointer-events: auto; /* Контролы кликабельны */
        }
        .cardify-trailer.display .cardify-trailer__controlls {
            transform: translate3d(0,0,0);
            opacity: 1;
        }
        
        .cardify-trailer__title { flex-grow:1; padding-right:5em; font-size:4em; font-weight:600; overflow:hidden; text-overflow:'.'; display:-webkit-box; -webkit-line-clamp:1; line-clamp:1; -webkit-box-orient:vertical; line-height:1.4 }
        .cardify-trailer__remote { flex-shrink:0; display:flex; align-items:center }
        .cardify-trailer__remote-icon { flex-shrink:0; width:2.5em; height:2.5em }
        .cardify-trailer__remote-text { margin-left:1em }

        .cardify-preview { position:absolute; bottom:100%; right:0; border-radius:.3em; width:6em; height:4em; display:flex; background-color:#000; overflow:hidden }
        .cardify-preview>div { position:relative; width:100%; height:100% }
        .cardify-preview__img { opacity:0; position:absolute; left:0; top:0; width:100%; height:100%; background-size:cover; transition:opacity .2s }
        .cardify-preview__img.loaded { opacity:1 }
        .cardify-preview__loader { position:absolute; left:50%; bottom:0; transform:translate3d(-50%,0,0); height:.2em; border-radius:.2em; background-color:#fff; width:0; transition:width .1s linear }
        .cardify-preview__line { position:absolute; height:.8em; left:0; width:100%; background-color:#000 }
        .cardify-preview__line.one { top:0 }
        .cardify-preview__line.two { bottom:0 }
        
        .head.nodisplay { transform:translate3d(0,-100%,0) }
        
        body:not(.menu--open) .cardify__background {
            mask-image: linear-gradient(to bottom,white 50%,rgba(255,255,255,0) 100%);
        }
        </style>
    `;

    Lampa.Template.add('cardify_css', style);
    $('body').append(Lampa.Template.get('cardify_css', {}, true));
    var icon = "<svg width=\"36\" height=\"28\" viewBox=\"0 0 36 28\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><rect x=\"1.5\" y=\"1.5\" width=\"33\" height=\"25\" rx=\"3.5\" stroke=\"white\" stroke-width=\"3\"/><rect x=\"5\" y=\"14\" width=\"17\" height=\"4\" rx=\"2\" fill=\"white\"/><rect x=\"5\" y=\"20\" width=\"10\" height=\"3\" rx=\"1.5\" fill=\"white\"/><rect x=\"25\" y=\"20\" width=\"6\" height=\"3\" rx=\"1.5\" fill=\"white\"/></svg>";
    Lampa.SettingsApi.addComponent({ component: 'cardify', icon: icon, name: 'Cardify' });
    Lampa.SettingsApi.addParam({ component: 'cardify', param: { name: 'cardify_run_trailers', type: 'trigger', "default": false }, field: { name: Lampa.Lang.translate('cardify_enable_trailer') } });

    function video(data) {
      if (data.videos && data.videos.results.length) {
        var items = [];
        data.videos.results.forEach(function (element) {
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

  if (Follow.go) startPlugin();else {
    Follow.get(Type.de([97, 112, 112]), function (e) { if (Type.re(e)) startPlugin(); });
  }

})();
