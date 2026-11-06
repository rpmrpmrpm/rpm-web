// The services of the app, made once.

import { CloudClient } from './api/cloud';
import { Api } from './api/http';
import { Session } from './api/session';

export const session = new Session('/accounts/');
export const api = new Api('/api/', session);
export const cloud = new CloudClient(api);

// Sign-up is open in a build with VITE_SIGN_UP_OPEN=true, or from a link with an invite. The server's
// sign-up itself stays open, so this is a gate on the page, and the real limit is the storage quota.
export const signUpOpen =
  import.meta.env.VITE_SIGN_UP_OPEN === 'true' || new URLSearchParams(location.search).has('invite');

export const BETA_FORM = 'https://rpmrpmrpm.com/beta';
export const FORGOT_PASSWORD = 'https://rpmrpmrpm.com/forgot-password';
