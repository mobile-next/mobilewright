// this is a skeleton test for mobilewright (see https://github.com/mobile-next/mobilewright/blob/main/README.md)
// for documentation see: https://mobilewright.dev/docs/
// for agent skill see: https://github.com/mobile-next/mobilewright-skill
import { test, expect } from '@mobilewright/test';

test('app launches and shows home screen', async ({ screen, device }) => {
  await expect(screen.getByText('Welcome')).toBeVisible();
});
