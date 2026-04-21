import { defineConfig } from 'mobilewright';
function resolveDriver() {
    const name = process.env['MOBILEWRIGHT_DRIVER'] ?? 'mobilecli';
    if (name === 'mobile-use') {
        return {
            type: 'mobile-use',
            apiKey: process.env['MOBILEWRIGHT_API_KEY'],
            region: process.env['MOBILEWRIGHT_REGION'],
        };
    }
    return { type: 'mobilecli' };
}
const config = defineConfig({
    testDir: './src',
    platform: process.env['MOBILEWRIGHT_PLATFORM'] ?? 'ios',
    driver: resolveDriver(),
});
export default config;
//# sourceMappingURL=mobilewright.config.js.map