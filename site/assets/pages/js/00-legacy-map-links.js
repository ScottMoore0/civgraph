/**
 * Forward pre-migration map links to /maps/.
 *
 * The interactive map lived at "/" and was addressed as /#layers=<id>, with the
 * catalogue publishing 795 such links plus one per election and feature. The map now
 * lives at /maps/ and this is the home page.
 *
 * A server redirect cannot rescue those links. Everything after the "#" is a FRAGMENT,
 * which browsers never send to the server, so _redirects would see a bare "/" and pass
 * it straight through to this page -- where the visitor would find a landing page and no
 * sign of the layer they were sent to look at. The forward has to happen here, in the
 * page, which is the only place the fragment is visible.
 *
 * Runs before anything else on the page and replaces the history entry rather than
 * pushing one, so Back returns where the visitor came from rather than bouncing.
 */
(function () {
  var hash = window.location.hash || '';
  if (hash.length < 2) return;
  // The state the old map understood. Anything else on this page is an in-page anchor.
  if (!/^#(layers=|electionBody=|electionDate=|featureMap=|basemap=|view=)/.test(hash)) return;
  window.location.replace('/maps/' + window.location.search + hash);
}());
