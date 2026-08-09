import { StyleguideContent } from "./StyleguideContent";

/**
 * Component styleguide.
 *
 * Renders every shared component in every state, with sample content drawn
 * from the real product. Its job is to be reviewed before any of these
 * components are used on a real screen, and afterwards to be the place a
 * regression shows up first.
 *
 * The clock is read here, on the server, and passed down as a fixed instant so
 * the server render and the client render of a countdown always agree. Sample
 * dates are then derived from it, so each example keeps demonstrating the state
 * it is labelled with however long from now the page is opened.
 */
export const dynamic = "force-dynamic";

export default function StyleguidePage() {
  return <StyleguideContent nowIso={new Date().toISOString()} />;
}
