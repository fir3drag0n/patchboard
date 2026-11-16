import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

/** A Docker API that knows one container, and remembers what was asked of it. */
function fakeDocker(name: string, image: string) {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`);
    const json = (body: unknown) => (res.setHeader('content-type', 'application/json'), res.end(JSON.stringify(body)));
    if (req.url?.startsWith('/containers/json')) return json([{ Id: `${name}0000000000`, Names: [`/${name}`], Image: image, ImageID: 'sha256:abc', State: 'running', Status: 'Up 2 days', Created: 1, Labels: { 'com.docker.compose.project': 'dns' } }]);
    if (req.url?.includes('/stats')) return json({ cpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 100 }, memory_stats: { usage: 5000 } });
    if (req.url === `/containers/${name}/json`) return json({ Id: `${name}0000000000`, Name: `/${name}`, Created: new Date().toISOString(), Image: 'sha256:abc', RestartCount: 0, State: { Status: 'running' }, Config: { Image: image, Tty: false } });
    if (req.method === 'POST' && req.url?.startsWith(`/containers/${name}/restart`)) return (res.statusCode = 204), res.end();
    if (req.url === '/version') return json({ Version: '27.3.1' });
    res.statusCode = 404;
    res.end();
  });
  return { server, asked };
}

const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

test('another Docker host: its containers are named name@host, and every call goes to it', async () => {
  const local = fakeDocker('plex', 'plexinc/pms-docker');
  const pi = fakeDocker('pihole', 'pihole/pihole');
  const localPort = await listen(local.server);
  const piPort = await listen(pi.server);
  // A third host nobody answers on: its containers are unknown, and it says so.
  process.env.DOCKER_HOST = `tcp://127.0.0.1:${localPort}`;
  process.env.DOCKER_HOSTS = `pi=tcp://127.0.0.1:${piPort}, gone=tcp://127.0.0.1:1`;
  const { dockerAdapter, containerAction, inspectContainer, statsAdapter } = await import('../adapters/docker.ts');
  try {
    const data = await dockerAdapter().fetch();
    assert.deepEqual(data.containers.map((c) => c.name), ['pihole@pi', 'plex']);
    assert.equal(data.containers.find((c) => c.name === 'pihole@pi')?.host, 'pi');
    assert.deepEqual(data.hosts?.map((h) => [h.name, h.ok]), [['pi', true], ['gone', false]]);

    const detail = await inspectContainer('pihole@pi', data.containers);
    assert.equal(detail.name, 'pihole@pi');
    await containerAction('pihole@pi', 'restart');
    assert.ok(pi.asked.some((a) => a.startsWith('POST /containers/pihole/restart')), 'the restart went to the pi');
    assert.ok(!local.asked.some((a) => a.includes('pihole')), 'and never to the local host');

    const stats = await statsAdapter().fetch();
    assert.ok('pihole@pi' in stats.containers && 'plex' in stats.containers);
    await assert.rejects(containerAction('x@nowhere', 'start'), /No Docker host called nowhere/);
  } finally {
    local.server.close();
    pi.server.close();
    delete process.env.DOCKER_HOST;
    delete process.env.DOCKER_HOSTS;
  }
});
