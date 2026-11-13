import { httpRouter } from "convex/server";
// Auth 2 issues deployment-signed sessions through its component. Password
// sign-in uses mutations; the legacy v1 HTTP/token routes are not exposed.
export default httpRouter();
