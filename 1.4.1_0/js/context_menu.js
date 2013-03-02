// Copyright 2011 Google Inc. All Rights Reserved.

/**
 * Search-by-Image Chrome extension context menu modifier.
 * Enables users to perform Search-by-Image by right clicking an image on
 * a website and selecting "Search Google with this image".
 * @author yimingli@google.com (Yiming Li)
 */

// Register the onClicked event listener.
chrome.contextMenus.onClicked.addListener(
    function(info, tab) { sbiSearch(info.srcUrl, true); });

// Create the Search-by-Image entry point on the context menu.
chrome.contextMenus.create({
    'title': chrome.i18n.getMessage('contextMenuTitle'),
    'contexts': ['image'],
    'id': 'sbiContextMenu'
});
