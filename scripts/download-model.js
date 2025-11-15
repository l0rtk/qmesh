#!/usr/bin/env node

/**
 * Standalone Model Download CLI
 * Quick script to download models without running full setup
 *
 * Usage:
 *   npm run download
 *   node scripts/download-model.js
 */

import { detectHardware, printHardwareInfo } from '../src/lib/hardware-detector.js';
import { ModelDownloader } from '../src/worker/model-downloader.js';

async function main() {
  console.log('📥 QMesh Model Downloader\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Detect hardware
    console.log('\n🔍 Detecting hardware...\n');

    const hardware = await detectHardware();
    printHardwareInfo(hardware);

    // Check requirements
    if (!hardware.requirements.passed) {
      console.error('\n❌ Hardware does not meet minimum requirements\n');
      hardware.requirements.errors.forEach(err => {
        console.error(`   • ${err}`);
      });
      process.exit(1);
    }

    console.log('='.repeat(60));

    // Step 2: Download model
    console.log('\n📦 Model Download\n');

    const downloader = new ModelDownloader();
    const modelPath = await downloader.interactiveDownload(hardware);

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Download complete!\n');
    console.log(`Model saved to: ${modelPath}\n`);
    console.log('You can now run: npm run worker\n');

  } catch (error) {
    if (error.message.includes('cancelled')) {
      console.log('\n⚠️  Download cancelled\n');
      process.exit(0);
    }

    console.error('\n❌ Download failed:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

main();
