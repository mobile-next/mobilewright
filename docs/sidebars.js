/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/intro',
        'getting-started/writing-tests',
        'getting-started/running-tests',
        'getting-started/ci',
      ],
    },
    {
      type: 'category',
      label: 'Mobilewright Test',
      collapsed: false,
      items: [
        'test/cli',
        'test/fixtures',
        'test/parallelism',
        'test/projects',
        'test/retries',
        'test/sharding',
        'test/timeouts',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/assertions',
        'guides/auto-waiting',
        'guides/docker',
        'guides/screenshots',
        'guides/troubleshooting',
        'guides/webviews',
      ],
    },
    {
      type: 'category',
      label: 'Integrations',
      collapsed: false,
      items: [
        'integrations/datadog',
        'integrations/checkly',
      ],
    },
    'changelog',
  ],
};

export default sidebars;
