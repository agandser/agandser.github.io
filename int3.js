(function () {
	"use strict";

	// ------------------------------------------------------------
	// Guard / Boot
	// ------------------------------------------------------------
	try { Lampa && Lampa.Platform && Lampa.Platform.tv && Lampa.Platform.tv(); } catch (e) {}

	if (typeof window === "undefined" || typeof window.Lampa === "undefined") return;
	if (!Lampa.Maker || !Lampa.Maker.map || !Lampa.Utils) return;

	// один раз
	if (window.style_interface_with_trailers_v1_ready) return;
	window.style_interface_with_trailers_v1_ready = true;

	var globalInfoCache = {};

	// базовые фиксы как в исходном плагине
	try {
		Lampa.Storage.set("interface_size", "small");
		Lampa.Storage.set("background", "false");
	} catch (e) {}

	// ------------------------------------------------------------
	// Trailer helpers (YT overlay)
	// ------------------------------------------------------------
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
		if (window.YT && window.YT.Player) return cb();

		if (document.getElementById("yt_iframe_api_lampa_trailer")) {
			var t = setInterval(function () {
				if (window.YT && window.YT.Player) {
					clearInterval(t);
					cb();
				}
			}, 200);
			return;
		}

		var tag = document.createElement("script");
		tag.id = "yt_iframe_api_lampa_trailer";
		tag.src = "https://www.youtube.com/iframe_api";
		document.head.appendChild(tag);

		var prev = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = function () {
			try { if (typeof prev === "function") prev(); } catch (e) {}
			cb();
		};
	}

	function needVideos() {
		try {
			return !!(
				Lampa.Storage.get("full_trailer_autoplay", true) ||
				Lampa.Storage.get("catalog_trailer_bg", false)
			);
		} catch (e) {
			return true;
		}
	}

	function getAppendParts() {
		var base = "content_ratings,release_dates";
		return needVideos() ? base + ",videos" : base;
	}

	function getMediaTypeFromData(data) {
		return data && (data.media_type === "tv" || data.name) ? "tv" : "movie";
	}

	function buildDetailUrl(data, appendParts) {
		if (!data || !data.id || !Lampa.TMDB || !Lampa.TMDB.api || !Lampa.TMDB.key) return "";
		var mediaType = getMediaTypeFromData(data);
		var language = Lampa.Storage.get("language") || "ru";
		return Lampa.TMDB.api(
			mediaType +
				"/" +
				data.id +
				"?api_key=" +
				Lampa.TMDB.key() +
				"&append_to_response=" +
				(appendParts || getAppendParts()) +
				"&language=" +
				language,
		);
	}

	function pickTrailerFromTmdbData(data) {
		if (!data || !data.videos || !data.videos.results || !data.videos.results.length) return null;

		var lang = (Lampa.Storage.get("language") || "ru") + "";
		var items = data.videos.results
			.filter(function (v) {
				return v && v.key && (!v.site || v.site === "YouTube");
			})
			.map(function (v) {
				return {
					id: v.key,
					lang: v.iso_639_1 || "",
					type: (v.type || "").toLowerCase(),
					official: !!v.official,
					time: v.published_at ? new Date(v.published_at).getTime() : 0,
				};
			});

		if (!items.length) return null;

		function score(x) {
			var s = 0;
			if (x.type === "trailer") s += 1000;
			if (x.lang === lang) s += 200;
			if (x.lang === "en") s += 50;
			if (x.official) s += 20;
			s += Math.min(100, Math.floor((x.time || 0) / 100000000)); // грубый приоритет новизны
			return s;
		}

		items.sort(function (a, b) {
			return score(b) - score(a);
		});

		return items[0] || null;
	}

	function ensureVideosForItem(data, cb) {
		if (!data || !data.id) return cb(data);

		// сначала пробуем кэш detail с videos
		var url = buildDetailUrl(data, "videos");
		if (url && globalInfoCache[url]) {
			// подмешаем videos в исходный объект если нужно
			try {
				if (!data.videos && globalInfoCache[url].videos) data.videos = globalInfoCache[url].videos;
			} catch (e) {}
			return cb(data);
		}

		// если videos уже есть
		if (data.videos && data.videos.results) return cb(data);

		// запросим только videos
		try {
			var source = data.source || "tmdb";
			if (source !== "tmdb" && source !== "cub") return cb(data);

			if (!Lampa.TMDB || !Lampa.TMDB.api || !Lampa.TMDB.key) return cb(data);

			var mediaType = getMediaTypeFromData(data);
			var language = Lampa.Storage.get("language") || "ru";

			var apiUrl =
				Lampa.TMDB.api(mediaType + "/" + data.id) +
				"?api_key=" +
				Lampa.TMDB.key() +
				"&append_to_response=videos" +
				"&language=" +
				language;

			var network = new Lampa.Reguest();
			network.silent(apiUrl, function (resp) {
				try {
					globalInfoCache[apiUrl] = resp;
				} catch (e) {}
				try {
					if (resp && resp.videos) data.videos = resp.videos;
				} catch (e2) {}
				cb(data);
			});
		} catch (e) {
			cb(data);
		}
	}

	function TrailerOverlay(opts) {
		this.wrapper = opts.wrapper; // DOM
		this.host = opts.host; // DOM
		this.onDisplay = opts.onDisplay || null;

		this.player = null;
		this.ready = false;
		this.pendingId = "";
		this.currentId = "";
		this.timer = null;

		this.failTimer = null;
	}

	TrailerOverlay.prototype._setDisplay = function (display) {
		try {
			if (!this.wrapper) return;
			if (display) this.wrapper.classList.add("trailer-display");
			else this.wrapper.classList.remove("trailer-display");
			if (this.onDisplay) this.onDisplay(!!display);
		} catch (e) {}
	};

	TrailerOverlay.prototype.destroy = function () {
		clearTimeout(this.timer);
		clearTimeout(this.failTimer);
		this.timer = null;
		this.failTimer = null;

		this.pendingId = "";
		this.currentId = "";
		this.ready = false;

		try { this._setDisplay(false); } catch (e) {}
		try { if (this.player && this.player.destroy) this.player.destroy(); } catch (e) {}
		this.player = null;

		try { if (this.wrapper && this.wrapper.parentNode) this.wrapper.parentNode.removeChild(this.wrapper); } catch (e) {}
		this.wrapper = null;
		this.host = null;
	};

	TrailerOverlay.prototype.pause = function () {
		clearTimeout(this.failTimer);
		this.failTimer = null;

		try {
			if (this.player && this.ready) this.player.pauseVideo();
		} catch (e) {}

		this._setDisplay(false);
	};

	TrailerOverlay.prototype.play = function (videoId, cfg) {
		var _this = this;
		cfg = cfg || {};

		clearTimeout(this.timer);
		clearTimeout(this.failTimer);
		this.failTimer = null;

		if (!videoId) return this.pause();

		this.pendingId = videoId;

		var delay = typeof cfg.delay === "number" ? cfg.delay : 700;
		var mute = !!cfg.mute;
		var quality = cfg.quality || "hd1080";

		this.timer = setTimeout(function () {
			if (_this.pendingId !== videoId) return;

			ensureYT(function () {
				if (!_this.host) return;

				function applyMute() {
					try {
						if (!_this.player || !_this.ready) return;
						if (mute) _this.player.mute();
						else _this.player.unMute();
					} catch (e) {}
				}

				function tryPlayWithFallback() {
					// если autoplay со звуком блокнут — попробуем замьютить
					clearTimeout(_this.failTimer);
					_this.failTimer = setTimeout(function () {
						try {
							if (!_this.player || !_this.ready) return;
							// если не показываемся — вероятно, не PLAYING
							if (_this.wrapper && !_this.wrapper.classList.contains("trailer-display") && !mute) {
								try { _this.player.mute(); } catch (e) {}
								try { _this.player.playVideo(); } catch (e2) {}
							}
						} catch (e3) {}
					}, 1600);
				}

				if (!_this.player) {
					_this.player = new YT.Player(_this.host, {
						width: window.innerWidth,
						height: window.innerHeight * 2,
						videoId: videoId,
						playerVars: {
							controls: 0,
							autoplay: 0,
							disablekb: 1,
							fs: 0,
							rel: 0,
							iv_load_policy: 3,
							modestbranding: 1,
							playsinline: 1,
						},
						events: {
							onReady: function () {
								_this.ready = true;
								_this.currentId = videoId;

								try { _this.player.setPlaybackQuality(quality); } catch (e) {}
								applyMute();

								try { _this.player.playVideo(); } catch (e2) {}
								tryPlayWithFallback();
							},
							onStateChange: function (st) {
								try {
									if (st.data === YT.PlayerState.PLAYING) _this._setDisplay(true);
									if (st.data === YT.PlayerState.PAUSED) _this._setDisplay(false);
									if (st.data === YT.PlayerState.ENDED) {
										_this.player.seekTo(0, true);
										_this.player.playVideo();
									}
									if (st.data === YT.PlayerState.BUFFERING) {
										try { st.target.setPlaybackQuality(quality); } catch (e) {}
									}
								} catch (e3) {}
							},
							onError: function () {
								_this.pause();
							},
						},
					});
				} else {
					_this.currentId = videoId;
					applyMute();

					try {
						_this.player.loadVideoById(videoId);
						tryPlayWithFallback();
					} catch (e) {
						try {
							_this.player.cueVideoById(videoId);
							_this.player.playVideo();
							tryPlayWithFallback();
						} catch (e2) {}
					}
				}
			});
		}, delay);
	};

	// ------------------------------------------------------------
	// Styles + Settings
	// ------------------------------------------------------------
	addStyles();
	initializeSettings();

	// vote colors + preload observers + full auto trailer
	setupVoteColorsObserver();
	setupVoteColorsForDetailPage();
	setupPreloadObserver();
	setupFullAutoTrailer();

	// ------------------------------------------------------------
	// Main maker hooks (catalog UI)
	// ------------------------------------------------------------
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

	// ------------------------------------------------------------
	// Enable rules
	// ------------------------------------------------------------
	function shouldEnableInterface(object) {
		if (!object) return false;
		if (window.innerWidth < 767) return false;
		if (Lampa.Platform && Lampa.Platform.screen && Lampa.Platform.screen("mobile")) return false;
		if (object.title === "Избранное") return false;
		return true;
	}

	// ------------------------------------------------------------
	// State (InfoPanel + Background + Catalog Trailer Overlay)
	// ------------------------------------------------------------
	function getOrCreateState(createInstance) {
		if (createInstance.__newInterfaceState) return createInstance.__newInterfaceState;
		var state = createState(createInstance);
		createInstance.__newInterfaceState = state;
		return state;
	}

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

		// трейлер-оверлей для каталога
		var trailerWrapper = document.createElement("div");
		trailerWrapper.className = "full-start__trailer-wrapper";
		var trailerHost = document.createElement("div");
		trailerWrapper.appendChild(trailerHost);
		backgroundWrapper.appendChild(trailerWrapper);

		var catalogTrailer = new TrailerOverlay({
			wrapper: trailerWrapper,
			host: trailerHost,
			onDisplay: function (display) {
				try {
					var container = mainInstance.render(true);
					if (container) {
						if (display) container.classList.add("trailer-on");
						else container.classList.remove("trailer-on");
					}
				} catch (e) {}
			},
		});

		var state = {
			main: mainInstance,
			info: infoPanel,
			background: backgroundWrapper,
			infoElement: null,
			backgroundTimer: null,
			backgroundLast: "",
			_pendingImg: null,
			attached: false,
			trailer: catalogTrailer,

			attach: function () {
				if (this.attached) return;

				var container = mainInstance.render(true);
				if (!container) return;

				container.classList.add("new-interface");

				if (!backgroundWrapper.parentElement) {
					container.insertBefore(backgroundWrapper, container.firstChild || null);
				}

				var infoElement = infoPanel.render(true);
				this.infoElement = infoElement;

				if (infoElement && infoElement.parentNode !== container) {
					if (backgroundWrapper.parentElement === container) {
						container.insertBefore(infoElement, backgroundWrapper.nextSibling);
					} else {
						container.insertBefore(infoElement, container.firstChild || null);
					}
				}

				try { mainInstance.scroll.minus(infoElement); } catch (e) {}
				this.attached = true;
			},

			update: function (data) {
				if (!data) return;

				infoPanel.update(data);
				this.updateBackground(data);

				// catalog trailers (optional)
				var enableTrailer = false;
				try { enableTrailer = !!Lampa.Storage.get("catalog_trailer_bg", false); } catch (e) {}

				if (!enableTrailer) {
					this.trailer.pause();
					return;
				}

				// только tmdb/cub
				var source = data.source || "tmdb";
				if (source !== "tmdb" && source !== "cub") {
					this.trailer.pause();
					return;
				}

				var mute = true;
				var delay = 700;
				try {
					mute = !Lampa.Storage.get("catalog_trailer_sound", false);
					delay = parseInt(Lampa.Storage.get("catalog_trailer_delay", "700"), 10) || 700;
				} catch (e2) {}

				var self = this;
				ensureVideosForItem(data, function (d) {
					var tr = pickTrailerFromTmdbData(d);
					if (!tr) return self.trailer.pause();
					self.trailer.play(tr.id, { mute: mute, delay: delay, quality: "hd1080" });
				});
			},

			updateBackground: function (data) {
				var BACKGROUND_DEBOUNCE_DELAY = 300;
				var self = this;

				clearTimeout(this.backgroundTimer);

				if (this._pendingImg) {
					this._pendingImg.onload = null;
					this._pendingImg.onerror = null;
					this._pendingImg = null;
				}

				var show_bg = Lampa.Storage.get("show_background", true);
				var bg_resolution = Lampa.Storage.get("background_resolution", "original");
				var backdropUrl =
					data && data.backdrop_path && show_bg ? Lampa.Api.img(data.backdrop_path, bg_resolution) : "";

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
					self._pendingImg = img;

					img.onload = function () {
						if (self._pendingImg !== img) return;
						if (backdropUrl !== self.backgroundLast) return;

						self._pendingImg = null;
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
				this.trailer.pause();
			},

			destroy: function () {
				clearTimeout(this.backgroundTimer);
				try { this.trailer.destroy(); } catch (e) {}
				infoPanel.destroy();

				var container = mainInstance.render(true);
				if (container) {
					container.classList.remove("new-interface");
					container.classList.remove("trailer-on");
				}

				if (this.infoElement && this.infoElement.parentNode) {
					this.infoElement.parentNode.removeChild(this.infoElement);
				}

				if (backgroundWrapper && backgroundWrapper.parentNode) {
					backgroundWrapper.parentNode.removeChild(backgroundWrapper);
				}

				this.attached = false;
			},
		};

		return state;
	}

	// ------------------------------------------------------------
	// Card handling
	// ------------------------------------------------------------
	function extendResultsWithStyle(data) {
		if (!data) return;

		if (Array.isArray(data.results)) {
			data.results.forEach(function (card) {
				if (card.wide !== false) card.wide = false;
			});

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
					if (targetStyle === "wide") {
						node.classList.add("card--wide");
						node.classList.remove("card--small");
					} else {
						node.classList.add("card--small");
						node.classList.remove("card--wide");
					}
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
				var cardData = getCardData(card, results);
				if (cardData) state.update(cardData);
			},
			onToggle: function () {
				setTimeout(function () {
					var focusedCard = getFocusedCard(line);
					if (focusedCard) state.update(focusedCard);
				}, 32);
			},
			onMore: function () { state.reset(); },
			onDestroy: function () {
				state.reset();
				delete line.__newInterfaceLine;
			},
		});

		if (Array.isArray(line.items) && line.items.length) line.items.forEach(processCard);

		if (line.last) {
			var lastCardData = findCardData(line.last);
			if (lastCardData) state.update(lastCardData);
		}
	}

	function wrapMethod(object, methodName, wrapper) {
		if (!object) return;
		var originalMethod = typeof object[methodName] === "function" ? object[methodName] : null;
		object[methodName] = function () {
			var args = Array.prototype.slice.call(arguments);
			return wrapper.call(this, originalMethod, args);
		};
	}

	// ------------------------------------------------------------
	// Styles (original + trailer css)
	// ------------------------------------------------------------
	function addStyles() {
		if (addStyles.added) return;
		addStyles.added = true;

		var styles = Lampa.Storage.get("wide_post") !== false ? getWideStyles() : getSmallStyles();

		Lampa.Template.add("new_interface_style_with_trailer_v1", styles);
		$("body").append(Lampa.Template.get("new_interface_style_with_trailer_v1", {}, true));

		// страховка позиционирования
		addOnceStyle("new_interface_trailer_position_fix", ".new-interface{position:relative}");
	}

	function trailerCssBlock() {
		return `
		.full-start__trailer-wrapper{
			opacity:0;
			transition:opacity .25s;
			pointer-events:none;
			position:absolute;
			top:-60%;
			bottom:-60%;
			left:0;
			width:100%;
			display:flex;
			align-items:center;
			z-index:-1;
		}
		.full-start__trailer-wrapper.trailer-display{ opacity:0.55; }
		.full-start__trailer-wrapper iframe{ border:0; width:100%; height:100%; flex-shrink:0; }
		.new-interface.trailer-on .full-start__background.active{ opacity:0 !important; }
		`;
	}

	function getWideStyles() {
		return `<style>
			.items-line{ padding-bottom: 4em !important; }
			.new-interface-info__head, .new-interface-info__details{ opacity: 0; transition: opacity 0.5s ease; min-height: 2.2em !important;}
			.new-interface-info__head.visible, .new-interface-info__details.visible{ opacity: 1; }
			.new-interface .card.card--wide, .new-interface .card.card--small { width: 18.3em; }
			.new-interface-info { position: relative; padding: 1.5em; height: 27.5em; }
			.new-interface-info__body { position: absolute; z-index: 9999999; width: 80%; padding-top: 1.1em; }
			.new-interface-info__head { color: rgba(255,255,255,0.6); font-size: 1.3em; min-height: 1em; }
			.new-interface-info__head span { color: #fff; }
			.new-interface-info__title { font-size: 4em; font-weight: 600; margin-bottom: 0.3em; overflow: hidden; text-overflow: '.'; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; margin-left: -0.03em; line-height: 1.3; }
			.new-interface-info__details { margin-top: 1.2em; margin-bottom: 1.6em; display:flex; align-items:center; flex-wrap:wrap; min-height:1.9em; font-size: 1.3em; }
			.new-interface-info__split { margin: 0 1em; font-size: 0.7em; }
			.new-interface-info__description { font-size: 1.4em; font-weight: 310; line-height: 1.3; overflow: hidden; text-overflow: '.'; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; width: 65%; }

			.new-interface .full-start__background-wrapper { position:absolute; top:0; left:0; width:100%; height:100%; z-index:-1; pointer-events:none; }
			.new-interface .full-start__background { position:absolute; height:108%; width:100%; top:-5em; left:0; opacity:0; object-fit:cover; transition: opacity .8s cubic-bezier(.4,0,.2,1); }
			.new-interface .full-start__background.active { opacity: 0.5; }

			.new-interface .full-start__rate { font-size: 1.3em; margin-right: 0; }
			.new-interface .card__promo { display:none; }
			.new-interface .card.card--wide .card-watched { display:none !important; }

			body.advanced--animation:not(.no--animation) .new-interface .card.card--wide.focus .card__view{ animation: animation-card-focus .2s; }
			body.advanced--animation:not(.no--animation) .new-interface .card.card--wide.animate-trigger-enter .card__view{ animation: animation-trigger-enter .2s forwards; }
			body.advanced--animation:not(.no--animation) .new-interface .card.card--small.focus .card__view{ animation: animation-card-focus .2s; }
			body.advanced--animation:not(.no--animation) .new-interface .card.card--small.animate-trigger-enter .card__view{ animation: animation-trigger-enter .2s forwards; }

			${Lampa.Storage.get("hide_captions", true) ? ".card:not(.card--collection) .card__age, .card:not(.card--collection) .card__title { display:none !important; }" : ""}

			${trailerCssBlock()}
		</style>`;
	}

	function getSmallStyles() {
		return `<style>
			.new-interface-info__head, .new-interface-info__details{ opacity: 0; transition: opacity 0.5s ease; min-height: 2.2em !important;}
			.new-interface-info__head.visible, .new-interface-info__details.visible{ opacity: 1; }
			.new-interface .card.card--wide{ width: 18.3em; }

			.new-interface-info { position: relative; padding: 1.5em; height: 19.8em; }
			.new-interface-info__body { position: absolute; z-index: 9999999; width: 80%; padding-top: 0.2em; }
			.new-interface-info__head { color: rgba(255,255,255,0.6); margin-bottom: 0.3em; font-size: 1.2em; min-height: 1em; }
			.new-interface-info__head span { color: #fff; }
			.new-interface-info__title { font-size: 3em; font-weight: 600; margin-bottom: 0.2em; overflow:hidden; text-overflow:'.'; display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; margin-left:-0.03em; line-height:1.3; }
			.new-interface-info__details { margin-top: 1.2em; margin-bottom: 1.6em; display:flex; align-items:center; flex-wrap:wrap; min-height: 1.9em; font-size: 1.2em; }
			.new-interface-info__split { margin: 0 1em; font-size: 0.7em; }
			.new-interface-info__description { font-size: 1.3em; font-weight: 310; line-height: 1.3; overflow:hidden; text-overflow:'.'; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; width:70%; }

			.new-interface .full-start__background-wrapper { position:absolute; top:0; left:0; width:100%; height:100%; z-index:-1; pointer-events:none; }
			.new-interface .full-start__background { position:absolute; height:108%; width:100%; top:-5em; left:0; opacity:0; object-fit:cover; transition: opacity .8s cubic-bezier(.4,0,.2,1); }
			.new-interface .full-start__background.active { opacity: 0.5; }

			.new-interface .full-start__rate { font-size: 1.2em; margin-right: 0; }
			.new-interface .card__promo { display:none; }
			.new-interface .card.card--wide .card-watched { display:none !important; }

			${Lampa.Storage.get("hide_captions", true) ? ".card:not(.card--collection) .card__age, .card:not(.card--collection) .card__title { display:none !important; }" : ""}

			${trailerCssBlock()}
		</style>`;
	}

	// ------------------------------------------------------------
	// Preload (now can include videos if needed)
	// ------------------------------------------------------------
	function preloadData(data) {
		if (!data || !data.id) return;

		var source = data.source || "tmdb";
		if (source !== "tmdb" && source !== "cub") return;

		var mediaType = getMediaTypeFromData(data);
		var language = Lampa.Storage.get("language") || "ru";
		var apiUrl = Lampa.TMDB.api(
			mediaType +
				"/" +
				data.id +
				"?api_key=" +
				Lampa.TMDB.key() +
				"&append_to_response=" +
				getAppendParts() +
				"&language=" +
				language,
		);

		if (!globalInfoCache[apiUrl]) {
			var network = new Lampa.Reguest();
			network.silent(apiUrl, function (response) {
				globalInfoCache[apiUrl] = response;
			});
		}
	}

	var preloadTimer = null;
	function preloadAllVisibleCards() {
		if (!Lampa.Storage.get("async_load", true)) return;

		clearTimeout(preloadTimer);
		preloadTimer = setTimeout(function () {
			var layer = $(".layer--visible");
			if (!layer.length) return;

			var cards = layer.find(".card");
			cards.each(function () {
				var data = findCardData(this);
				if (data) preloadData(data);
			});
		}, 800);
	}

	function setupPreloadObserver() {
		var observer = new MutationObserver(function (mutations) {
			if (!Lampa.Storage.get("async_load", true)) return;

			var hasNewCards = false;
			for (var i = 0; i < mutations.length; i++) {
				var added = mutations[i].addedNodes;
				for (var j = 0; j < added.length; j++) {
					var node = added[j];
					if (node.nodeType === 1) {
						if (node.classList.contains("card") || node.querySelector(".card")) {
							hasNewCards = true;
							break;
						}
					}
				}
				if (hasNewCards) break;
			}

			if (hasNewCards) preloadAllVisibleCards();
		});

		observer.observe(document.body, { childList: true, subtree: true });
	}

	// ------------------------------------------------------------
	// InfoPanel (mostly original)
	// ------------------------------------------------------------
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
		this.html = $(
			'<div class="new-interface-info">' +
				'<div class="new-interface-info__body">' +
					'<div class="new-interface-info__head"></div>' +
					'<div class="new-interface-info__title"></div>' +
					'<div class="new-interface-info__details"></div>' +
					'<div class="new-interface-info__description"></div>' +
				"</div>" +
			"</div>",
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

		this.html.find(".new-interface-info__head,.new-interface-info__details").removeClass("visible");

		var title = this.html.find(".new-interface-info__title");
		var desc = this.html.find(".new-interface-info__description");

		desc.text(data.overview || Lampa.Lang.translate("full_notext"));

		clearTimeout(this.fadeTimer);

		// не убираем — так было в исходном плагине
		try { Lampa.Background.change(Lampa.Api.img(data.backdrop_path, "original")); } catch (e) {}

		this.load(data);

		title.text(data.title || data.name || "");
		title.css({ opacity: 1 });

		// логотип вместо названия (как раньше)
		if (Lampa.Storage.get("logo_show", true)) this.showLogo(data, currentRenderId);
	};

	InfoPanel.prototype.showLogo = function (data, renderId) {
		var _this = this;

		if (!data || !data.id) return;

		var FADE_OUT_TEXT = 300;
		var FADE_IN_IMG = 400;
		var TARGET_WIDTH = "7em";

		var title_elem = this.html.find(".new-interface-info__title");
		var dom_title = title_elem[0];

		function applyFinalStyles(img) {
			img.style.width = TARGET_WIDTH;
			img.style.height = "auto";
			img.style.maxWidth = "100%";
			img.style.maxHeight = "none";
			img.style.display = "block";
			img.style.objectFit = "contain";
			img.style.objectPosition = "left bottom";
			img.style.transition = "none";
		}

		function startLogo(img_url) {
			if (renderId && renderId !== _this.lastRenderId) return;

			var img = new Image();
			img.src = img_url;
			applyFinalStyles(img);
			img.style.opacity = "0";

			img.onload = function () {
				if (renderId && renderId !== _this.lastRenderId) return;

				title_elem.css({ transition: "opacity " + FADE_OUT_TEXT / 1000 + "s ease", opacity: "0" });

				setTimeout(function () {
					if (renderId && renderId !== _this.lastRenderId) return;

					title_elem.empty().append(img);
					title_elem.css({ opacity: "1", transition: "none" });

					setTimeout(function () {
						if (renderId && renderId !== _this.lastRenderId) return;
						img.style.transition = "opacity " + FADE_IN_IMG / 1000 + "s ease";
						img.style.opacity = "1";
					}, 50);

					// фикс высоты, чтобы не прыгало
					try { dom_title.style.height = ""; } catch (e) {}
				}, FADE_OUT_TEXT);
			};
		}

		var type = data.name ? "tv" : "movie";
		var language = Lampa.Storage.get("language") || "ru";
		var cache_key = "logo_cache_v2_" + type + "_" + data.id + "_" + language;
		var cached_url = Lampa.Storage.get(cache_key);

		if (cached_url && cached_url !== "none") return startLogo(cached_url);

		var url = Lampa.TMDB.api(
			type +
				"/" +
				data.id +
				"/images?api_key=" +
				Lampa.TMDB.key() +
				"&include_image_language=" +
				language +
				",en,null",
		);

		$.get(url, function (data_api) {
			if (renderId && renderId !== _this.lastRenderId) return;

			var final_logo = null;
			if (data_api && data_api.logos && data_api.logos.length > 0) {
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
				startLogo(img_url);
			} else {
				Lampa.Storage.set(cache_key, "none");
			}
		}).fail(function () {});
	};

	InfoPanel.prototype.load = function (data) {
		if (!data || !data.id) return;

		var source = data.source || "tmdb";
		if (source !== "tmdb" && source !== "cub") return;

		if (!Lampa.TMDB || typeof Lampa.TMDB.api !== "function" || typeof Lampa.TMDB.key !== "function") return;

		var language = Lampa.Storage.get("language") || "ru";
		var mediaType = getMediaTypeFromData(data);

		var apiUrl = Lampa.TMDB.api(
			mediaType +
				"/" +
				data.id +
				"?api_key=" +
				Lampa.TMDB.key() +
				"&append_to_response=" +
				getAppendParts() +
				"&language=" +
				language,
		);

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

		var detailsInfo = [];

		// рейтинг TMDB
		if (Lampa.Storage.get("rat") !== false) {
			if (rating > 0) {
				var rate_style = "";
				if (Lampa.Storage.get("colored_ratings", true)) {
					var vote_num = parseFloat(rating);
					var color = getColorByRating(vote_num);
					if (color) rate_style = ' style="color: ' + color + '"';
				}
				detailsInfo.push('<div class="full-start__rate"' + rate_style + "><div>" + rating + "</div><div>TMDB</div></div>");
			}
		}

		// жанры
		if (Lampa.Storage.get("ganr") !== false) {
			if (data.genres && data.genres.length > 0) {
				detailsInfo.push(
					data.genres
						.slice(0, 2)
						.map(function (g) { return Lampa.Utils.capitalizeFirstLetter(g.name); })
						.join(" | "),
				);
			}
		}

		// runtime
		if (Lampa.Storage.get("vremya") !== false) {
			if (data.runtime) detailsInfo.push(Lampa.Utils.secondsToTime(data.runtime * 60, true));
		}

		// год
		var yc = [];
		if (year !== "0000") yc.push("<span>" + year + "</span>");
		if (yc.length) detailsInfo.push(yc.join(", "));

		this.html.find(".new-interface-info__head").empty().append("").toggleClass("visible", false);
		this.html
			.find(".new-interface-info__details")
			.html(detailsInfo.join('<span class="new-interface-info__split">&#9679;</span>'))
			.addClass("visible");
	};

	InfoPanel.prototype.empty = function () {
		if (!this.html) return;
		this.html.find(".new-interface-info__head,.new-interface-info__details").text("").removeClass("visible");
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

	// ------------------------------------------------------------
	// Vote Colors (original logic)
	// ------------------------------------------------------------
	function getColorByRating(vote) {
		if (isNaN(vote)) return "";
		if (vote >= 0 && vote <= 3) return "red";
		if (vote > 3 && vote < 6) return "orange";
		if (vote >= 6 && vote < 7) return "cornflowerblue";
		if (vote >= 7 && vote < 8) return "darkmagenta";
		if (vote >= 8 && vote <= 10) return "lawngreen";
		return "";
	}

	function applyColorByRating(element) {
		var $el = $(element);
		var voteText = $el.text().trim();

		if (/^\d+(\.\d+)?K$/.test(voteText)) return;

		var match = voteText.match(/(\d+(\.\d+)?)/);
		if (!match) return;

		var vote = parseFloat(match[0]);
		var color = getColorByRating(vote);

		if (color && Lampa.Storage.get("colored_ratings", true)) {
			$el.css("color", color);

			if (Lampa.Storage.get("rating_border", false) && !$el.hasClass("card__vote")) {
				if ($el.parent().hasClass("full-start__rate")) {
					$el.parent().css("border", "1px solid " + color);
					$el.css("border", "");
				} else if ($el.hasClass("full-start__rate") || $el.hasClass("full-start-new__rate") || $el.hasClass("info__rate")) {
					$el.css("border", "1px solid " + color);
				} else {
					$el.css("border", "");
				}
			} else {
				$el.css("border", "");
				if ($el.parent().hasClass("full-start__rate")) $el.parent().css("border", "");
			}
		} else {
			$el.css("color", "");
			$el.css("border", "");
			if ($el.parent().hasClass("full-start__rate")) $el.parent().css("border", "");
		}
	}

	function updateVoteColors() {
		if (!Lampa.Storage.get("colored_ratings", true)) return;

		$(".card__vote").each(function () { applyColorByRating(this); });
		$(".full-start__rate, .full-start-new__rate").each(function () { applyColorByRating(this); });
		$(".info__rate, .card__imdb-rate, .card__kinopoisk-rate").each(function () { applyColorByRating(this); });
		$(".rate--kp, .rate--imdb, .rate--cub").each(function () { applyColorByRating($(this).find("> div").eq(0)); });
	}

	function setupVoteColorsObserver() {
		updateVoteColors();

		var observer = new MutationObserver(function (mutations) {
			if (!Lampa.Storage.get("colored_ratings", true)) return;

			for (var i = 0; i < mutations.length; i++) {
				var added = mutations[i].addedNodes;
				for (var j = 0; j < added.length; j++) {
					var node = added[j];
					if (node.nodeType === 1) {
						var $node = $(node);
						$node
							.find(".card__vote, .full-start__rate, .full-start-new__rate, .info__rate, .card__imdb-rate, .card__kinopoisk-rate")
							.each(function () { applyColorByRating(this); });

						$node.find(".rate--kp, .rate--imdb, .rate--cub").each(function () {
							applyColorByRating($(this).find("> div").eq(0));
						});

						if ($node.hasClass("card__vote") || $node.hasClass("full-start__rate") || $node.hasClass("info__rate")) applyColorByRating(node);
						if ($node.hasClass("rate--kp") || $node.hasClass("rate--imdb") || $node.hasClass("rate--cub")) applyColorByRating($node.find("> div").eq(0));
					}
				}
			}
		});

		observer.observe(document.body, { childList: true, subtree: true });
	}

	function setupVoteColorsForDetailPage() {
		if (!window.Lampa || !Lampa.Listener) return;

		Lampa.Listener.follow("full", function (data) {
			if (data && (data.type === "complite" || data.type === "complete")) updateVoteColors();
		});

		Lampa.Listener.follow("activity", function (e) {
			if (e && (e.type === "active" || e.type === "start")) setTimeout(preloadAllVisibleCards, 1000);
		});

		Lampa.Listener.follow("target", function (e) {
			if (e && e.target && $(e.target).hasClass("card")) preloadAllVisibleCards();
		});
	}

	// ------------------------------------------------------------
	// Full page auto trailer (no template replace)
	// ------------------------------------------------------------
	function setupFullAutoTrailer() {
		if (!window.Lampa || !Lampa.Listener) return;

		var fullOverlay = null;
		var checkTimer = null;
		var activityRef = null;

		function stop() {
			clearInterval(checkTimer);
			checkTimer = null;
			activityRef = null;
			if (fullOverlay) {
				try { fullOverlay.destroy(); } catch (e) {}
				fullOverlay = null;
			}
		}

		function isTopView(activity) {
			try {
				var name = Lampa.Controller.enabled().name;
				if (name && name !== "full_start") return false;
			} catch (e) {}

			try {
				var body = activity.render().find(".full-start-new__body, .full-start__body").eq(0);
				if (body.length) {
					var top = body[0].getBoundingClientRect().top;
					if (top < -20) return false;
				}
			} catch (e2) {}

			return true;
		}

		Lampa.Listener.follow("activity", function (e) {
			if (e && e.type === "destroy") stop();
		});

		Lampa.Listener.follow("full", function (e) {
			if (!e) return;
			if (!(e.type === "complite" || e.type === "complete")) return;

			if (!Lampa.Storage.get("full_trailer_autoplay", true)) return;

			stop();

			var activity = e.object && e.object.activity;
			if (!activity || !activity.render) return;

			var root = activity.render();
			var bg = root.find(".full-start__background, .full-start-new__background").eq(0);
			if (!bg.length) return;

			var wrap = document.createElement("div");
			wrap.className = "full-start__trailer-wrapper";
			var host = document.createElement("div");
			wrap.appendChild(host);

			var tag = (bg[0].tagName || "").toLowerCase();
			if (tag === "img") bg.after(wrap);
			else bg.append(wrap);

			var overlay = new TrailerOverlay({
				wrapper: wrap,
				host: host,
				onDisplay: function (display) {
					try {
						bg.toggleClass("cardify-bgtrailer--on", !!display);
						if (tag === "img") bg.css("opacity", display ? "0" : "");
						else bg.find("img").eq(0).css("opacity", display ? "0" : "");
					} catch (e) {}
				},
			});

			fullOverlay = overlay;
			activityRef = activity;

			var mute = true;
			try { mute = !Lampa.Storage.get("full_trailer_sound", true); } catch (e2) {}

			ensureVideosForItem(e.data, function (dataWithVideos) {
				var tr = pickTrailerFromTmdbData(dataWithVideos);
				if (!tr) return;

				overlay.play(tr.id, { mute: mute, delay: 900, quality: "hd1080" });

				checkTimer = setInterval(function () {
					try {
						if (!fullOverlay) return;
						if (!Lampa.Activity.active() || Lampa.Activity.active().activity !== activityRef) return fullOverlay.pause();
						if (!isTopView(activityRef)) return fullOverlay.pause();
						// наверху — пусть играет
					} catch (e) {}
				}, 250);
			});
		});
	}

	// ------------------------------------------------------------
	// Settings (merged into "Стильный интерфейс")
	// ------------------------------------------------------------
	function initializeSettings() {
		if (!Lampa.Settings || !Lampa.SettingsApi) return;

		// добавляем пункт в "Интерфейс"
		Lampa.Settings.listener.follow("open", function (event) {
			if (event.name == "main") {
				if (Lampa.Settings.main().render().find('[data-component="style_interface"]').length == 0) {
					Lampa.SettingsApi.addComponent({
						component: "style_interface",
						name: "Стильный интерфейс",
					});
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
			},
		});

		// --- визуал (как было)
		Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "logo_show", type: "trigger", default: true }, field: { name: "Показывать логотип вместо названия" } });
		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "show_background", type: "trigger", default: true },
			field: { name: "Отображать постеры на фоне" },
			onChange: function (value) { if (!value) $(".full-start__background").removeClass("active"); },
		});
		Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "colored_ratings", type: "trigger", default: true }, field: { name: "Цветные рейтинги" },
			onChange: function (value) {
				if (value) updateVoteColors();
				else {
					$(".card__vote, .full-start__rate, .full-start-new__rate, .info__rate, .card__imdb-rate, .card__kinopoisk-rate").css("color", "").css("border", "");
					$(".full-start__rate").css("border", "");
				}
			},
		});
		Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "rating_border", type: "trigger", default: false }, field: { name: "Обводка рейтингов" }, onChange: function () { updateVoteColors(); } });
		Lampa.SettingsApi.addParam({ component: "style_interface", param: { name: "async_load", type: "trigger", default: true }, field: { name: "Включить асинхронную загрузку данных" }, onChange: function (v) { if (v) preloadAllVisibleCards(); } });
		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "background_resolution", type: "select", default: "original", values: { w300: "w300", w780: "w780", w1280: "w1280", original: "original" } },
			field: { name: "Разрешение фона", description: "Качество загружаемых фоновых изображений" },
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

		// --- трейлеры (новое)
		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "full_trailer_autoplay", type: "trigger", default: true },
			field: { name: "Автотрейлер на странице фильма" },
		});
		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "full_trailer_sound", type: "trigger", default: true },
			field: { name: "Звук автотрейлера на странице фильма" },
		});
		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "catalog_trailer_bg", type: "trigger", default: false },
			field: { name: "Трейлер в каталоге (на фоне)" },
		});
		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "catalog_trailer_sound", type: "trigger", default: false },
			field: { name: "Звук трейлера в каталоге" },
		});
		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: {
				name: "catalog_trailer_delay",
				type: "select",
				default: "700",
				values: { "300": "300ms", "700": "700ms", "1200": "1200ms" },
			},
			field: { name: "Задержка включения трейлера в каталоге" },
		});

		// очистка кеша логотипов (как было)
		Lampa.SettingsApi.addParam({
			component: "style_interface",
			param: { name: "int_clear_logo_cache", type: "static" },
			field: { name: "Очистить кеш логотипов", description: "Лампа будет перезагружена" },
			onRender: function (item) {
				item.on("hover:enter", function () {
					Lampa.Select.show({
						title: "Очистить кеш логотипов?",
						items: [{ title: "Да", confirm: true }, { title: "Нет" }],
						onSelect: function (a) {
							if (a.confirm) {
								var keys = [];
								for (var i = 0; i < localStorage.length; i++) {
									var key = localStorage.key(i);
									if (key.indexOf("logo_cache_v2_") !== -1) keys.push(key);
								}
								keys.forEach(function (k) { localStorage.removeItem(k); });
								window.location.reload();
							} else {
								Lampa.Controller.toggle("settings_component");
							}
						},
						onBack: function () { Lampa.Controller.toggle("settings_component"); },
					});
				});
			},
		});

		// дефолты один раз
		var initInterval = setInterval(function () {
			if (typeof Lampa !== "undefined") {
				clearInterval(initInterval);
				if (!Lampa.Storage.get("int_plug", false)) setDefaultSettings();
			}
		}, 200);

		function setDefaultSettings() {
			Lampa.Storage.set("int_plug", "true");
			Lampa.Storage.set("wide_post", "true");
			Lampa.Storage.set("logo_show", "true");
			Lampa.Storage.set("show_background", "true");
			Lampa.Storage.set("background_resolution", "original");
			Lampa.Storage.set("colored_ratings", "true");
			Lampa.Storage.set("async_load", "true");
			Lampa.Storage.set("hide_captions", "true");
			Lampa.Storage.set("rating_border", "false");
			Lampa.Storage.set("interface_size", "small");

			// трейлеры
			Lampa.Storage.set("full_trailer_autoplay", "true");
			Lampa.Storage.set("full_trailer_sound", "true");
			Lampa.Storage.set("catalog_trailer_bg", "false");
			Lampa.Storage.set("catalog_trailer_sound", "false");
			Lampa.Storage.set("catalog_trailer_delay", "700");
		}
	}
})();
