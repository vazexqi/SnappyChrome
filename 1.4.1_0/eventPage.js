// Copyright 2012 Google Inc. All Rights Reserved.

/**
 * Search-by-Image Chrome extension event page.
 * @author howardzhou@google.com (Howard Zhou)
 */

/**
 * The Search-by-Image server URL.
 * @private
 * @const
 */
var SERVER_ = 'www.google.com';

/**
 * The version parameter name for the Chrome extension.
 * @private
 * @const
 */
var CHROME_EXTENSION_VERSION_PARAMETER_NAME_ = 'sbisrc';

/**
 * The version string for Chrome extension.
 * @private
 * @const
 */
var CHROME_EXTENSION_VERSION_ = 'cr_1_4_1';

/**
 * This function validates the string only contains a-z, A-Z, 0-9, +, /, ..
 * @param {!string} str The string to be validated.
 * @return {boolean} The validation result.
 */
function validateBase64(str) {
  for (var i = 0, c; c = str[i++]; ) {
    if ((c >= 'a' && c <= 'z') ||
        (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') ||
        c == '+' || c == '\/' ||
        c == '.' || c == '=') {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Find the ideal thumbnail size to scale a given image down to.
 * This mirrors the server-side calculations, so that we will not
 * need any downscaling, but also will not lose any information.
 * @param {!number} width The width of the input image.
 * @param {!number} height The height of the input image.
 * @return {{width: !number, height: !number}} The width and height
 *     to scale down to.
 */
function findThumbnailSize(width, height) {
  var max_width = 600;
  var max_height = 400;
  var max_pixels = 300 * 300;

  if (width > max_width) {
    var factor = max_width / width;
    width *= factor;
    height *= factor;
  }
  if (height > max_height) {
    var factor = max_height / height;
    width *= factor;
    height *= factor;
  }
  if (width * height > max_pixels) {
    var factor = Math.sqrt(max_pixels / (width * height));
    width *= factor;
    height *= factor;
  }

  width = Math.round(width);
  height = Math.round(height);

  return { 'width': width, 'height': height };
}

/**
 * Create a JPEG thumbnail from the given image (using an HTML5 canvas
 * element), and return it as a data: URL. Note that this is expected to be
 * called from the background page (with also the DOM element being on the
 * backgroud page) and we have <all_urls> in our permission list, we should not
 * get any problems with the canvas being tainted, as we might otherwise get.
 *
 * @param {!HTMLImageElement} img The image to be thumbnailized.
 * @return {string} A data: URL with the thumbnail in JPEG form.
 */
function getThumbnailDataURL(img) {
  var dimensions = findThumbnailSize(img.width, img.height);
  var canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;

  var ctx = canvas.getContext('2d');

  // Draw a white background first, in case the image has transparency.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dimensions.width, dimensions.height);

  ctx.drawImage(img, 0, 0, dimensions.width, dimensions.height);

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Generate HTML for a new page that will POST the search-by-image request.
 * @param {!string} data_url The data: URL of the image to search with.
 * @param {number=} width The width of the original image, if known.
 * @param {number=} height The height of the original image, if known.
 * @return {!string} HTML for the web page.
 */
function getSbiPageHTML(data_url, width, height) {
  var base64Offset = data_url.indexOf(',');
  var inlineImage = data_url.substring(base64Offset + 1)
      .replace(/\+/g, '-').replace(/\//g, '_')
      .replace(/\./g, '=');
  var html = '<html><head>' +
      '<title>' + chrome.i18n.getMessage('extensionName') + '</title></head>' +
      '<body><form id="f" method="POST" ' +
      'action="https://' + SERVER_ + '/searchbyimage/upload" ' +
      'enctype="multipart/form-data">' +
      '<input type="hidden" name="image_content" value="' + inlineImage + '">' +
      '<input type="hidden" name="filename" value="">' +
      '<input type="hidden" name="image_url" value="">' +
      '<input type="hidden" name="' + CHROME_EXTENSION_VERSION_PARAMETER_NAME_ +
      '" value="' + CHROME_EXTENSION_VERSION_ + '">';
  if (width !== undefined && height !== undefined) {
    html += '<input type="hidden" name="width" value="' + width + '">' +
        '<input type="hidden" name="height" value="' + height + '">';
  }
  html += '</form>' +
      '<script>document.getElementById("f").submit();</script></body></html>';
  return html;
}

/**
 * Do a search-by-image for the given image URL, by fetching it
 * (hopefully out of the browser cache), thumbnailizing it and then
 * opening a new tab where it is POSTed to Google's servers.
 *
 * @param {!string} url The URL of the image.
 * @param {boolean} selected Whether to select the new tab or not.
 */
function sbiSearch(url, selected) {
  if (url.indexOf('data:') == 0) {
    doRealSbiSearch(url, selected);
  } else {
    chrome.storage.sync.get('sbi_get_url',
      /**
       * Callback function for chrome.storage.sync. Get the option values from
       * Chrome Storage API.
       * @param {Object.<{sbi_get_url}>} items The returned storage contents,
       *     items in their key-value mappings.
       */
      function(items) {
        var useGetRequests = items.sbi_get_url;
        if (useGetRequests) {
          doGetSbiSearch(url, selected);
        } else {
          loadImageAndSearch(url, selected);
        }
      }
    );
  }
}

/**
 * Thumbnailize the given image and do a search-by-image for the thumbnail
 * in a new tab.
 *
 * @param {!string} url The URL of the image.
 * @param {boolean} selected Whether to select the new tab or not.
 */
function loadImageAndSearch(url, selected) {
  /*
   * We cannot send DOM elements from the web page's process across to the
   * extension, and the web page can be subject to canvas tainting, so we
   * cannot do the thumbnalizing on that side. Thus, our best bet is to create
   * a new image with the same URL and thumbnailize that. Hopefully it will
   * come from the cache.
   */
  var loading_img = /** @type {!HTMLImageElement} */
      (document.createElement('img'));
  loading_img.onload = function() { imageLoaded(loading_img, selected); };
  loading_img.src = url;
}

/**
 * Callback function for when the image to be thumbnailed is done loading.
 *
 * @param {!HTMLImageElement} img The image that just finished loading.
 * @param {boolean} selected Whether to select the new tab or not.
 */
function imageLoaded(img, selected) {
  var data_url = getThumbnailDataURL(img);
  img.src = null;
  doRealSbiSearch(data_url, selected, img.width, img.height);
}

/**
 * Actually search for the given image.
 *
 * @param {string} data_url The URL containing the image to search for.
 *     Must be a data: URL.
 * @param {boolean} selected Whether to select the new tab or not.
 * @param {number=} width The width of the original image, if known.
 * @param {number=} height The height of the original image, if known.
 */
function doRealSbiSearch(data_url, selected, width, height) {
  if (data_url === undefined) {
    return;
  }

  // Make sure the content type is valid to avoid security attack.
  var lower_src = data_url.toLowerCase();
  if (lower_src.indexOf('data:image/bmp;') != 0 &&
      lower_src.indexOf('data:image/gif;') != 0 &&
      lower_src.indexOf('data:image/jpeg;') != 0 &&
      lower_src.indexOf('data:image/jpg;') != 0 &&
      lower_src.indexOf('data:image/png;') != 0 &&
      lower_src.indexOf('data:image/webp;') != 0 &&
      lower_src.indexOf('data:image/tiff;') != 0 &&
      lower_src.indexOf('data:image/x-ico;') != 0 &&
      lower_src.indexOf('data:image/x-tiff;') != 0) {
    return;
  }

  var base64Offset = data_url.indexOf(',');
  if (base64Offset == -1 ||
      !validateBase64(data_url.substring(base64Offset + 1))) {
    return;
  }

  var page_html = getSbiPageHTML(data_url, width, height);
  var page_url = 'data:text/html;charset=utf-8;base64,' +
      window.btoa(page_html);

  chrome.tabs.query({
    'active': true,
    'lastFocusedWindow': true
  }, function(tab) {
    chrome.tabs.create({
      'url': page_url,
      'index': tab[0].index + 1,
      'selected': selected
    });
  });
}

/**
 * Search for a given image, but with a GET request instead of the usual POST.
 * Mainly useful for debugging.
 *
 * @param {string} url The URL containing the image to search for.
 * @param {boolean} selected Whether to select the new tab or not.
 */
function doGetSbiSearch(url, selected) {
  var search_url = 'http://' + SERVER_ + '/searchbyimage?' +
      CHROME_EXTENSION_VERSION_PARAMETER_NAME_ + '=' +
      CHROME_EXTENSION_VERSION_ +
      '&image_url=' + encodeURIComponent(url);

  chrome.tabs.query({
    'active': true,
    'lastFocusedWindow': true
  }, function(tab) {
    chrome.tabs.create({
      'url': search_url,
      'index': tab[0].index + 1,
      'selected': selected
    });
  });
}

/**
 * Chrome extension request handler.
 * Handles all requests from other parts of this extension.
 * @param {!Object} request The request sent by other parts of the ext.
 * @param {Object} sender The sender of the request.
 * @param {Object} callback The callback of this request.
 */
function onMessage(request, sender, callback) {
  switch (request.action) {
    case 'sbiSearch':
      // Perform Search-by-Image for the given URL, and open a new tab to the
      // right of the current tab to display the search result.
      // If request.selected is true, select/highlight the result tab.
      // Otherwise, stay on the current tab.
      sbiSearch(request.url, request.selected);
      break;
  }
}

// Add the onMessage function as the listener.
chrome.extension.onMessage.addListener(onMessage);
