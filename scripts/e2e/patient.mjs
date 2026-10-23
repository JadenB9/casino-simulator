// For a busy machine: preload it into any of these scripts and every page's default timeouts go
// from 30 s to minutes, so a run checks what works rather than how quickly software rendering
// keeps up when the machine is shared. A script's own explicit timeouts still apply.
//
//   node --import ./scripts/e2e/patient.mjs scripts/e2e/journey.mjs 6400 /tmp/out
//   PATIENT_ACTION_MS=300000 PATIENT_NAV_MS=600000 node --import ./scripts/e2e/patient.mjs ...

import { chromium } from 'playwright';

const ACTION_MS = Number(process.env.PATIENT_ACTION_MS ?? 180_000);
const NAV_MS = Number(process.env.PATIENT_NAV_MS ?? 300_000);
const patient = (o) => {
  o.setDefaultTimeout(ACTION_MS);
  o.setDefaultNavigationTimeout(NAV_MS);
  return o;
};
const launch = chromium.launch.bind(chromium);
chromium.launch = async (...args) => {
  const browser = await launch(...args);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...o) => {
    const ctx = patient(await newContext(...o));
    const newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async (...p) => patient(await newPage(...p));
    return ctx;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...o) => patient(await newPage(...o));
  return browser;
};
