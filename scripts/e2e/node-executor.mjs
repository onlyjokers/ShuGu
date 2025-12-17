import { spawn } from 'node:child_process';
import net from 'node:net';
import process from 'node:process';
import { chromium } from 'playwright';

const ROOT = process.cwd();

const SERVER_PORT = 3001;
const MANAGER_PORT = 5173;
const CLIENT_PORT = 5174;

const SERVER_ORIGIN = `https://localhost:${SERVER_PORT}`;
const MANAGER_ORIGIN = `https://localhost:${MANAGER_PORT}`;
const CLIENT_ORIGIN = `https://localhost:${CLIENT_PORT}`;

const CLIENT_ID = 'c_e2e';
const MANAGER_USER = 'Eureka';

function spawnService(label, args) {
  const proc = spawn('pnpm', args, {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `[e2e:${label}]`;
  proc.stdout?.on('data', (buf) => process.stdout.write(`${prefix} ${buf}`));
  proc.stderr?.on('data', (buf) => process.stderr.write(`${prefix} ${buf}`));

  proc.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${prefix} exited with code ${code}`);
    }
  });

  return proc;
}

function waitForPort(port, { host = '127.0.0.1', timeoutMs = 60_000 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ port, host });
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`timeout waiting for ${host}:${port}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

function loopGraph({ clientId, primary }) {
  const ids = {
    client: 'node-client-e2e',
    sensors: 'node-sensors-e2e',
    screen: 'node-screen-e2e',
  };

  return {
    nodes: [
      {
        id: ids.client,
        type: 'client-object',
        position: { x: 60, y: 140 },
        config: { clientId },
        inputValues: {},
        outputValues: {},
      },
      {
        id: ids.sensors,
        type: 'proc-client-sensors',
        position: { x: 360, y: 140 },
        config: {},
        inputValues: {},
        outputValues: {},
      },
      {
        id: ids.screen,
        type: 'proc-screen-color',
        position: { x: 660, y: 120 },
        config: {
          primary,
          secondary: '#ffffff',
          maxOpacity: 1,
          minOpacity: 0,
          waveform: 'sine',
          frequencyHz: 1.5,
        },
        inputValues: {},
        outputValues: {},
      },
    ],
    connections: [
      {
        id: 'conn-e2e-client-to-sensors',
        sourceNodeId: ids.client,
        sourcePortId: 'out',
        targetNodeId: ids.sensors,
        targetPortId: 'client',
      },
      {
        id: 'conn-e2e-client-to-screen',
        sourceNodeId: ids.client,
        sourcePortId: 'out',
        targetNodeId: ids.screen,
        targetPortId: 'client',
      },
      {
        id: 'conn-e2e-sensors-to-screen',
        sourceNodeId: ids.sensors,
        sourcePortId: 'accelX',
        targetNodeId: ids.screen,
        targetPortId: 'frequencyHz',
      },
      {
        id: 'conn-e2e-screen-to-client',
        sourceNodeId: ids.screen,
        sourcePortId: 'cmd',
        targetNodeId: ids.client,
        targetPortId: 'in',
      },
    ],
  };
}

async function assert(condition, message) {
  if (condition) return;
  throw new Error(message);
}

async function main() {
  const procs = [
    spawnService('server', ['dev:server']),
    spawnService('manager', ['dev:manager']),
    spawnService('client', ['dev:client']),
  ];

  const cleanup = async () => {
    for (const p of procs) {
      try {
        p.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  };

  process.on('SIGINT', () => cleanup().finally(() => process.exit(130)));
  process.on('SIGTERM', () => cleanup().finally(() => process.exit(143)));

  try {
    await Promise.all([
      waitForPort(SERVER_PORT),
      waitForPort(MANAGER_PORT),
      waitForPort(CLIENT_PORT),
    ]);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });

    await context.addCookies([
      {
        name: 'shugu-manager-auth',
        value: MANAGER_USER,
        url: MANAGER_ORIGIN,
        sameSite: 'Lax',
      },
    ]);

    const clientPage = await context.newPage();
    await clientPage.addInitScript(
      ({ serverUrl, clientId }) => {
        localStorage.setItem('shugu-server-url', serverUrl);
        localStorage.setItem('shugu-device-id', clientId);
        sessionStorage.setItem('shugu-client-instance-id', 'i_e2e');
        sessionStorage.setItem('shugu-client-id', clientId);
        window.__SHUGU_E2E = true;
        window.__SHUGU_E2E_COMMANDS = [];
      },
      { serverUrl: SERVER_ORIGIN, clientId: CLIENT_ID }
    );

    await clientPage.goto(`${CLIENT_ORIGIN}/?server=${encodeURIComponent(SERVER_ORIGIN)}&e2e=1`, {
      waitUntil: 'domcontentloaded',
    });

    const managerPage = await context.newPage();
    managerPage.on('dialog', (dialog) => dialog.accept());

    await managerPage.addInitScript((serverUrl) => {
      localStorage.setItem('shugu-server-url', serverUrl);
    }, SERVER_ORIGIN);

    await managerPage.goto(`${MANAGER_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await managerPage.getByRole('button', { name: 'Connect' }).click();

    await managerPage.getByRole('button', { name: /Node Graph/ }).waitFor({ timeout: 60_000 });
    await managerPage.waitForSelector(`text=${CLIENT_ID}`, { timeout: 60_000 });

    await managerPage.getByRole('button', { name: /Node Graph/ }).click();
    await managerPage.waitForFunction(() => Boolean(window.__shuguNodeEngine), null, {
      timeout: 20_000,
    });

    const graphV1 = loopGraph({ clientId: CLIENT_ID, primary: '#6366f1' });
    await managerPage.evaluate((graph) => window.__shuguNodeEngine.loadGraph(graph), graphV1);
    await managerPage.waitForSelector('.loop-controls', { timeout: 10_000 });
    await managerPage.waitForFunction(
      () => document.querySelectorAll('.node.local-loop').length > 0,
      null,
      {
        timeout: 10_000,
      }
    );

    await managerPage.getByRole('button', { name: /Deploy Loop/ }).click();
    await managerPage.waitForSelector('text=Stop Loop', { timeout: 10_000 });
    await managerPage.waitForFunction(
      () => document.querySelectorAll('.node.deployed-loop').length > 0,
      null,
      {
        timeout: 10_000,
      }
    );

    const beforeCount = await clientPage.evaluate(() => (window.__SHUGU_E2E_COMMANDS || []).length);
    await clientPage.waitForFunction(
      (count) => (window.__SHUGU_E2E_COMMANDS || []).length > count,
      beforeCount,
      { timeout: 10_000 }
    );

    const last = await clientPage.evaluate(() => window.__SHUGU_E2E_LAST_COMMAND);
    await assert(
      last?.action === 'screenColor',
      `expected screenColor action, got ${String(last?.action)}`
    );

    await managerPage.getByRole('button', { name: /Stop Loop/ }).click();

    const stoppedCount = await clientPage.evaluate(
      () => (window.__SHUGU_E2E_COMMANDS || []).length
    );
    await managerPage.waitForTimeout(800);
    const stoppedAfter = await clientPage.evaluate(
      () => (window.__SHUGU_E2E_COMMANDS || []).length
    );
    await assert(stoppedAfter === stoppedCount, 'expected no new commands after Stop Loop');

    // Update graph (same node ids) and redeploy.
    const graphV2 = loopGraph({ clientId: CLIENT_ID, primary: '#ff0000' });
    await managerPage.evaluate((graph) => window.__shuguNodeEngine.loadGraph(graph), graphV2);
    await managerPage.waitForSelector('.loop-controls', { timeout: 10_000 });

    await managerPage.getByRole('button', { name: /Deploy Loop/ }).click();
    await managerPage.waitForSelector('text=Stop Loop', { timeout: 10_000 });

    const redeployCount = await clientPage.evaluate(
      () => (window.__SHUGU_E2E_COMMANDS || []).length
    );
    await clientPage.waitForFunction(
      (count) => (window.__SHUGU_E2E_COMMANDS || []).length > count,
      redeployCount,
      { timeout: 10_000 }
    );

    const updated = await clientPage.evaluate(() => window.__SHUGU_E2E_LAST_COMMAND);
    await assert(
      updated?.action === 'screenColor',
      `expected screenColor action, got ${String(updated?.action)}`
    );
    await assert(
      updated?.payload?.color === '#ff0000',
      `expected updated primary color, got ${String(updated?.payload?.color)}`
    );

    await managerPage.getByRole('button', { name: /Remove/ }).click();
    await managerPage.waitForSelector('text=Deploy Loop', { timeout: 10_000 });

    console.log('[e2e] ✅ node-executor loop deploy/stop/redeploy/remove OK');

    await browser.close();
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[e2e] ❌ failed:', message);
    throw error;
  } finally {
    await cleanup();
  }
}

await main();
