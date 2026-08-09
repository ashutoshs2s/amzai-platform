import { redirect } from "next/navigation";

/**
 * The programme list is the default landing screen. DESIGN.md section 6.1.
 *
 * The environment check that used to live here is at /health. It is a
 * diagnostic rather than a product screen, so it does not deserve the front
 * door and does not render inside the app shell.
 */
export default function RootPage() {
  redirect("/programs");
}
