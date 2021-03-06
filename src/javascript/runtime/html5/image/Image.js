/**
 * Image.js
 *
 * Copyright 2013, Moxiecode Systems AB
 * Released under GPL License.
 *
 * License: http://www.plupload.com/license
 * Contributing: http://www.plupload.com/contributing
 */

/**
@class moxie/runtime/html5/image/Image
@private
*/
define("moxie/runtime/html5/image/Image", [
	"moxie/runtime/html5/Runtime",
	"moxie/core/utils/Basic",
	"moxie/core/Exceptions",
	"moxie/core/utils/Encode",
	"moxie/file/Blob",
	"moxie/file/File",
	"moxie/runtime/html5/image/ImageInfo",
	"moxie/runtime/html5/image/MegaPixel",
	"moxie/runtime/html5/image/Resample",
	"moxie/core/utils/Mime",
	"moxie/core/utils/Env"
], function(extensions, Basic, x, Encode, Blob, File, ImageInfo, MegaPixel, Resample, Mime, Env) {
	
	function HTML5Image() {
		var me = this
		, _img, _imgInfo, _canvas, _binStr, _blob
		, _modified = false // is set true whenever image is modified
		, _preserveHeaders = true
		;

		Basic.extend(this, {
			loadFromBlob: function(blob) {
				var comp = this, I = comp.getRuntime()
				, asBinary = arguments.length > 1 ? arguments[1] : true
				;

				if (!I.can('access_binary')) {
					throw new x.RuntimeError(x.RuntimeError.NOT_SUPPORTED_ERR);
				}

				_blob = blob;

				if (blob.isDetached()) {
					_binStr = blob.getSource();
					_preload.call(this, _binStr);
					return;
				} else {
					_readAsDataUrl.call(this, blob.getSource(), function(dataUrl) {
						if (asBinary) {
							_binStr = _toBinary(dataUrl);
						}
						_preload.call(comp, dataUrl);
					});
				}
			},

			loadFromImage: function(img, exact) {
				this.meta = img.meta;

				_blob = new File(null, {
					name: img.name,
					size: img.size,
					type: img.type
				});

				_preload.call(this, exact ? (_binStr = img.getAsBinaryString()) : img.getAsDataURL());
			},

			getInfo: function() {
				var I = this.getRuntime(), info;

				if (!_imgInfo && _binStr && I.can('access_image_binary')) {
					_imgInfo = new ImageInfo(_binStr);
				}

				info = {
					width: _getImg().width || 0,
					height: _getImg().height || 0,
					type: _blob.type || Mime.getFileMime(_blob.name),
					size: _binStr && _binStr.length || _blob.size || 0,
					name: _blob.name || '',
					meta: _imgInfo && _imgInfo.meta || this.meta || {}
				};

				// store thumbnail data as blob
				if (info.meta.thumb && typeof(info.meta.thumb.data) === 'string') {
					info.meta.thumb.data = new Blob(null, {
						type: 'image/jpeg',
						data: info.meta.thumb.data
					});
				}

				return info;
			},

			downsize: function(opts) {
				var tgtWidth, tgtHeight, orientation, scale;

				if (!_canvas && !_img) {
					throw new x.ImageError(x.DOMException.INVALID_STATE_ERR);
				}

				orientation = (this.meta && this.meta.tiff && this.meta.tiff.Orientation) || 1;
				
				// we will need to check this on export (see getAsBinaryString())
				_preserveHeaders = opts.preserve_headers || opts.preserveHeaders; // preserve_headers is Plupload syntax


				if (!_canvas) {
					_canvas = document.createElement('canvas');
					_canvas.width = _img.width;
					_canvas.height = _img.height;
					_drawToCanvas(_img, _canvas, 0, 0, _img.width, _img.height);
				}

				// calculate actual dimensions of the target image
				if (Basic.inArray(orientation, [5,6,7,8]) !== -1) {
					// swap dimensions for images that require 90 degree (or multiple of it) rotation
					tgtWidth = opts.height;
					tgtHeight = opts.width;
				} else {
					tgtWidth = opts.width;
					tgtHeight = opts.height;
				}

				if (opts.crop) {
					// one of the dimensions may exceed the actual image dimensions - we take the smallest value
					tgtWidth = Math.min(tgtWidth, _canvas.width);
					tgtHeight = Math.min(tgtHeight, _canvas.height);

					scale = Math.max(tgtWidth / _canvas.width, tgtHeight / _canvas.height);
				} else {
					scale = Math.min(tgtWidth / _canvas.width, tgtHeight / _canvas.height);
				}


				// we only downsize here
				if (scale > 1 && !opts.crop && _preserveHeaders) {
					this.trigger('Resize');
					return;
				}


				// extract image data of appropriate dimensions
				var dataWidth = _canvas.width
				, dataHeight = _canvas.height
				, dataX = 0
				, dataY = 0
				, data
				;

				if (opts.crop) {
					dataWidth = Math.max(dataWidth, Math.ceil(tgtWidth / scale));
					dataHeight = Math.max(dataHeight, Math.ceil(tgtHeight / scale));

					// if dimensions of the resulting image still larger than canvas, center it
					if (dataWidth < _canvas.width) {
						dataX = Math.round((_canvas.width - dataWidth) / 2);
					}

					if (destHeight < this.height) {
						dataY = Math.round((_canvas.height - dataHeight) / 2);
					}
				}

				data = _canvas.getContext('2d').getImageData(dataX, dataY, dataWidth, dataHeight);


				// now we need to resample our image data down gradually
				var tgtData = _downsize.call(this, data, scale, opts.resample);

				_canvas = null; // purge kinda
				_canvas = document.createElement("canvas");
				_canvas.width = tgtData.width;
				_canvas.height = tgtData.height;				
				_canvas.getContext('2d').putImageData(tgtData, 0, 0);

				/*
				// rotate if required, according to orientation tag
				if (!_preserveHeaders) {
					_rotateToOrientaion(_canvas.width, _canvas.height, orientation);
				}*/

				_modified = true;
				this.trigger('Resize');
			},


			getAsCanvas: function() {
				if (_canvas) {
					_canvas.id = this.uid + '_canvas';
				}
				return _canvas;
			},

			getAsBlob: function(type, quality) {
				if (type !== this.type) {
					// if different mime type requested prepare image for conversion
					_downsize.call(this, this.width, this.height, false);
				}
				return new File(null, {
					name: _blob.name || '',
					type: type,
					data: me.getAsBinaryString.call(this, type, quality)
				});
			},

			getAsDataURL: function(type) {
				var quality = arguments[1] || 90;

				// if image has not been modified, return the source right away
				if (!_modified) {
					return _img.src;
				}

				if ('image/jpeg' !== type) {
					return _canvas.toDataURL('image/png');
				} else {
					try {
						// older Geckos used to result in an exception on quality argument
						return _canvas.toDataURL('image/jpeg', quality/100);
					} catch (ex) {
						return _canvas.toDataURL('image/jpeg');
					}
				}
			},

			getAsBinaryString: function(type, quality) {
				// if image has not been modified, return the source right away
				if (!_modified) {
					// if image was not loaded from binary string
					if (!_binStr) {
						_binStr = _toBinary(me.getAsDataURL(type, quality));
					}
					return _binStr;
				}

				if ('image/jpeg' !== type) {
					_binStr = _toBinary(me.getAsDataURL(type, quality));
				} else {
					var dataUrl;

					// if jpeg
					if (!quality) {
						quality = 90;
					}

					try {
						// older Geckos used to result in an exception on quality argument
						dataUrl = _canvas.toDataURL('image/jpeg', quality/100);
					} catch (ex) {
						dataUrl = _canvas.toDataURL('image/jpeg');
					}

					_binStr = _toBinary(dataUrl);

					if (_imgInfo) {
						_binStr = _imgInfo.stripHeaders(_binStr);

						if (_preserveHeaders) {
							// update dimensions info in exif
							if (_imgInfo.meta && _imgInfo.meta.exif) {
								_imgInfo.setExif({
									PixelXDimension: this.width,
									PixelYDimension: this.height
								});
							}

							// re-inject the headers
							_binStr = _imgInfo.writeHeaders(_binStr);
						}

						// will be re-created from fresh on next getInfo call
						_imgInfo.purge();
						_imgInfo = null;
					}
				}

				_modified = false;

				return _binStr;
			},

			destroy: function() {
				me = null;
				_purge.call(this);
				this.getRuntime().getShim().removeInstance(this.uid);
			}
		});


		function _getImg() {
			if (!_canvas && !_img) {
				throw new x.ImageError(x.DOMException.INVALID_STATE_ERR);
			}
			return _canvas || _img;
		}


		function _toBinary(str) {
			return Encode.atob(str.substring(str.indexOf('base64,') + 7));
		}


		function _toDataUrl(str, type) {
			return 'data:' + (type || '') + ';base64,' + Encode.btoa(str);
		}


		function _preload(str) {
			var comp = this;

			_img = new Image();
			_img.onerror = function() {
				_purge.call(this);
				comp.trigger('error', x.ImageError.WRONG_FORMAT);
			};
			_img.onload = function() {
				comp.trigger('load');
			};

			_img.src = str.substr(0, 5) == 'data:' ? str : _toDataUrl(str, _blob.type);
		}


		function _readAsDataUrl(file, callback) {
			var comp = this, fr;

			// use FileReader if it's available
			if (window.FileReader) {
				fr = new FileReader();
				fr.onload = function() {
					callback(this.result);
				};
				fr.onerror = function() {
					comp.trigger('error', x.ImageError.WRONG_FORMAT);
				};
				fr.readAsDataURL(file);
			} else {
				return callback(file.getAsDataURL());
			}
		}


		function _downsize(image, scale, algorithm) {
			var currScale = 1;
			var factor = 0.6;
			var finalScale = scale;

			function pyramid(image, scale, algorithm) {
				var destWidth = Math.round(image.width * scale);
				var destHeight = Math.round(image.height * scale);
				var destImage = _canvas.getContext('2d').createImageData(destWidth, destHeight);

				var rgb, x, y, idx = 0;

				for (y = 0; y < destHeight; y++) {
					for (x = 0; x < destWidth; x++, idx = (y * destWidth + x) * 4) {
						rgb = Resample[algorithm](image.data, x / scale, y / scale, image.width);
						destImage.data[idx] = rgb[0];
						destImage.data[idx + 1] = rgb[1];
						destImage.data[idx + 2] = rgb[2];
						destImage.data[idx + 3] = 255;
					}
				}
				image = null;
				return destImage;
			}
			
			if (scale < factor && algorithm !== 'nearest') {
				// for the factor <= 0.5 bilinear and bicubic algorithms drop in quality significantly
				while ((currScale *= factor) > scale) {
					image = pyramid(image, factor, algorithm);
				}

				finalScale = factor * (scale / currScale);
			}

			
			if (finalScale < 1) {
				image = pyramid(image, finalScale, algorithm);
			}

			return image;
		}


		function _drawToCanvas(img, canvas, x, y, w, h) {
			if (Env.OS === 'iOS') { 
				// avoid squish bug in iOS6
				MegaPixel.renderTo(img, canvas, { width: w, height: h, x: x, y: y });
			} else {
				canvas.getContext('2d').drawImage(img, x, y, w, h);
			}
		}


		/**
		* Transform canvas coordination according to specified frame size and orientation
		* Orientation value is from EXIF tag
		* @author Shinichi Tomita <shinichi.tomita@gmail.com>
		*/
		function _rotateToOrientaion(width, height, orientation) {
			switch (orientation) {
				case 5:
				case 6:
				case 7:
				case 8:
					_canvas.width = height;
					_canvas.height = width;
					break;
				default:
					_canvas.width = width;
					_canvas.height = height;
			}

			/**
			1 = The 0th row is at the visual top of the image, and the 0th column is the visual left-hand side.
			2 = The 0th row is at the visual top of the image, and the 0th column is the visual right-hand side.
			3 = The 0th row is at the visual bottom of the image, and the 0th column is the visual right-hand side.
			4 = The 0th row is at the visual bottom of the image, and the 0th column is the visual left-hand side.
			5 = The 0th row is the visual left-hand side of the image, and the 0th column is the visual top.
			6 = The 0th row is the visual right-hand side of the image, and the 0th column is the visual top.
			7 = The 0th row is the visual right-hand side of the image, and the 0th column is the visual bottom.
			8 = The 0th row is the visual left-hand side of the image, and the 0th column is the visual bottom.
			*/

			var ctx = _canvas.getContext('2d');
			switch (orientation) {
				case 2:
					// horizontal flip
					ctx.translate(width, 0);
					ctx.scale(-1, 1);
					break;
				case 3:
					// 180 rotate left
					ctx.translate(width, height);
					ctx.rotate(Math.PI);
					break;
				case 4:
					// vertical flip
					ctx.translate(0, height);
					ctx.scale(1, -1);
					break;
				case 5:
					// vertical flip + 90 rotate right
					ctx.rotate(0.5 * Math.PI);
					ctx.scale(1, -1);
					break;
				case 6:
					// 90 rotate right
					ctx.rotate(0.5 * Math.PI);
					ctx.translate(0, -height);
					break;
				case 7:
					// horizontal flip + 90 rotate right
					ctx.rotate(0.5 * Math.PI);
					ctx.translate(width, -height);
					ctx.scale(-1, 1);
					break;
				case 8:
					// 90 rotate left
					ctx.rotate(-0.5 * Math.PI);
					ctx.translate(-width, 0);
					break;
			}
		}


		function _purge() {
			if (_imgInfo) {
				_imgInfo.purge();
				_imgInfo = null;
			}
			_binStr = _img = _canvas = _blob = null;
			_modified = false;
		}
	}

	return (extensions.Image = HTML5Image);
});
