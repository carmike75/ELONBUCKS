import fs from 'fs';

import test from 'ava';
import nock from 'nock';

import {
  CDNTokenListResolutionStrategy,
  CLUSTER_SLUGS,
  ENV,
  GitHubTokenListResolutionStrategy,
  SolanaTokenListResolutionStrategy,
  Strategy,
  TokenInfo,
  TokenListProvider,
} from './tokenlist';

nock.disableNetConnect();

test('Token list is filterable by a tag', async (t) => {
  const list = (await new TokenListProvider().resolve(Strategy.Static))
    .filterByChainId(ENV.MainnetBeta)
    .filterByTag('nft')
    .getList();

  t.false(list.some((item) => item.symbol === 'SOL'));
  t.true(list.length > 0);
  t.true(list.every((item) => (item.tags || []).includes('nft')));
});

test('Token list can exclude by a tag', async (t) => {
  const list = (await new TokenListProvider().resolve(Strategy.Static))
    .filterByChainId(ENV.MainnetBeta)
    .excludeByTag('nft')
    .getList();

  t.true(list.length > 0);
  t.false(list.some((item) => (item.tags || []).includes('nft')));
});

test('Token list can exclude by a chain', async (t) => {
  const list = (await new TokenListProvider().resolve(Strategy.Static))
    .excludeByChainId(ENV.MainnetBeta)
    .getList();

  t.true(list.length > 0);
  t.false(list.some((item) => item.chainId === ENV.MainnetBeta));
});

test('Token list returns new object upon filter', async (t) => {
  const list = await new TokenListProvider().resolve(Strategy.Static);
  const filtered = list.filterByChainId(ENV.MainnetBeta);
  t.true(list !== filtered);
  t.true(list.getList().length !== filtered.getList().length);
});

test('Token list throws error when calling filterByClusterSlug with slug that does not exist', async (t) => {
  const list = await new TokenListProvider().resolve(Strategy.Static);
  const error = await t.throwsAsync(
    async () => list.filterByClusterSlug('whoop'),
    { instanceOf: Error }
  );
  t.is(
    error.message,
    `Unknown slug: whoop, please use one of ${Object.keys(CLUSTER_SLUGS)}`
  );
});

test('Token list is filterable by cluster slug for each known cluster', async (t) => {
  const list = await new TokenListProvider().resolve(Strategy.Static);

  for (const slug of Object.keys(CLUSTER_SLUGS)) {
    const filtered = list.filterByClusterSlug(slug).getList();
    t.true(filtered.length > 0, `expected tokens for slug ${slug}`);
    t.true(
      filtered.every((item) => item.chainId === CLUSTER_SLUGS[slug]),
      `expected every token for slug ${slug} to have matching chainId`
    );
  }
});

test('GitHub strategy falls back to the static list when the remote fetch fails', async (t) => {
  const strategy = new GitHubTokenListResolutionStrategy();
  const scope = nock('https://raw.githubusercontent.com')
    .get('/solana-labs/token-list/main/src/tokens/solana.tokenlist.json')
    .replyWithError('simulated network failure');

  const tokens = await strategy.resolve();

  t.true(tokens.length > 0);
  t.true(scope.isDone());
});

test('CDN strategy falls back to the static list when the remote fetch fails', async (t) => {
  const strategy = new CDNTokenListResolutionStrategy();
  const scope = nock('https://cdn.jsdelivr.net')
    .get('/gh/solana-labs/token-list@latest/src/tokens/solana.tokenlist.json')
    .replyWithError('simulated network failure');

  const tokens = await strategy.resolve();

  t.true(tokens.length > 0);
  t.true(scope.isDone());
});

test('Solana strategy resolves tokens from a successful remote fetch', async (t) => {
  const strategy = new SolanaTokenListResolutionStrategy();
  const fakeList = {
    name: 'fake',
    logoURI: '',
    tags: {},
    timestamp: new Date().toISOString(),
    tokens: [
      {
        chainId: ENV.MainnetBeta,
        address: 'FakeAddress111111111111111111111111111111',
        name: 'Fake Token',
        decimals: 6,
        symbol: 'FAKE',
      },
    ],
  };
  const scope = nock('https://token-list.solana.com')
    .get('/solana.tokenlist.json')
    .reply(200, fakeList);

  const tokens = await strategy.resolve();

  t.true(scope.isDone());
  t.deepEqual(tokens, fakeList.tokens);
});

test('TokenListProvider defaults to the CDN strategy', async (t) => {
  const scope = nock('https://cdn.jsdelivr.net')
    .get('/gh/solana-labs/token-list@latest/src/tokens/solana.tokenlist.json')
    .replyWithError('simulated network failure');

  const list = await new TokenListProvider().resolve();

  t.true(scope.isDone());
  t.true(list.getList().length > 0);
});

test('Token list is a valid json', async (t) => {
  t.notThrows(() => {
    const content = fs
      .readFileSync('./src/tokens/solana.tokenlist.json')
      .toString();
    JSON.parse(content.toString());
  });
});

test('Token list does not have duplicate entries', async (t) => {
  const list = await new TokenListProvider().resolve(Strategy.Static);
  list
    .filterByChainId(ENV.MainnetBeta)
    .getList()
    .reduce((agg, item) => {
      if (agg.has(item.address)) {
        console.log(item.address);
      }

      t.false(agg.has(item.address));
      agg.set(item.address, item);
      return agg;
    }, new Map<string, TokenInfo>());
});
