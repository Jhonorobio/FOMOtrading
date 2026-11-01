const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withGoogleServices = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const b64 = process.env.GOOGLE_SERVICES_JSON_BASE64;
      if (!b64) {
        console.warn('GOOGLE_SERVICES_JSON_BASE64 no definido, saltando google-services.json');
        return config;
      }
      const json = Buffer.from(b64, 'base64').toString('utf8');
      const target = path.join(config.modRoot, 'android', 'app', 'google-services.json');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, json);
      console.log(`Escrito: ${target}`);
      return config;
    },
  ]);
};

module.exports = withGoogleServices;
