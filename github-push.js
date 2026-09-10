#!/usr/bin/env node

/**
 * Small-Cap Radar GitHub Push Tool
 * ادفع كل الكود مباشرة إلى GitHub repository
 * 
 * Usage:
 * node github-push.js <personal-access-token>
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const REPO_OWNER = 'yousef-hamda';
const REPO_NAME = 'smallcap-radar';
const REPO_PATH = '/home/claude/smallcap-radar';
const BRANCH = 'main';

// GitHub API helpers
function makeGitHubRequest(method, endpoint, token, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'smallcap-radar'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getRepoInfo(token) {
  console.log('📋 Getting repository info...');
  const response = await makeGitHubRequest(
    'GET',
    `/repos/${REPO_OWNER}/${REPO_NAME}`,
    token
  );
  
  if (response.status !== 200) {
    throw new Error(`Failed to get repo info: ${response.status}`);
  }
  
  return response.data;
}

async function pushFilesToGitHub(token) {
  console.log('\n📦 Small-Cap Radar — GitHub Push Tool');
  console.log('═════════════════════════════════════════\n');

  try {
    // Get repo info
    const repo = await getRepoInfo(token);
    console.log(`✓ Repository: ${repo.full_name}`);
    console.log(`✓ Branch: ${BRANCH}\n`);

    // Get all files
    const files = getAllFiles(REPO_PATH);
    console.log(`📁 Found ${files.length} files to push\n`);

    // Get current commit SHA
    let treeSHA = null;
    try {
      const refResponse = await makeGitHubRequest(
        'GET',
        `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${BRANCH}`,
        token
      );
      if (refResponse.status === 200) {
        treeSHA = refResponse.data.object.sha;
        console.log(`✓ Current HEAD: ${treeSHA.substring(0, 8)}`);
      }
    } catch (e) {
      console.log('ℹ Branch does not exist yet, will create it');
    }

    // Create tree with all files
    console.log('\n📤 Creating commit...');
    const treeItems = files.map(file => {
      const content = fs.readFileSync(file.path, 'utf8');
      return {
        path: file.relative,
        mode: '100644',
        type: 'blob',
        content: content
      };
    });

    // Create tree
    const treeResponse = await makeGitHubRequest(
      'POST',
      `/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`,
      token,
      {
        tree: treeItems,
        base_tree: treeSHA || undefined
      }
    );

    if (treeResponse.status !== 201) {
      throw new Error(`Failed to create tree: ${treeResponse.status}`);
    }

    const newTreeSHA = treeResponse.data.sha;
    console.log(`✓ Tree created: ${newTreeSHA.substring(0, 8)}`);

    // Create commit
    const commitResponse = await makeGitHubRequest(
      'POST',
      `/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`,
      token,
      {
        message: 'Initial commit: Small-Cap Radar — Arabic stock screener\n\n- React 19 + TanStack Start\n- Cloudflare Workers + D1\n- 9-factor scoring engine\n- Complete documentation',
        tree: newTreeSHA,
        parents: treeSHA ? [treeSHA] : []
      }
    );

    if (commitResponse.status !== 201) {
      throw new Error(`Failed to create commit: ${commitResponse.status}`);
    }

    const commitSHA = commitResponse.data.sha;
    console.log(`✓ Commit created: ${commitSHA.substring(0, 8)}`);

    // Update ref
    console.log('\n🔗 Updating branch...');
    const updateResponse = await makeGitHubRequest(
      treeSHA ? 'PATCH' : 'POST',
      treeSHA 
        ? `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${BRANCH}`
        : `/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`,
      token,
      treeSHA
        ? { sha: commitSHA, force: true }
        : { ref: `refs/heads/${BRANCH}`, sha: commitSHA }
    );

    if (![200, 201].includes(updateResponse.status)) {
      throw new Error(`Failed to update branch: ${updateResponse.status}`);
    }

    console.log(`✓ Branch ${BRANCH} updated\n`);

    // Success!
    console.log('═════════════════════════════════════════');
    console.log('✅ SUCCESS! All files pushed to GitHub\n');
    console.log(`📍 Repository: https://github.com/${REPO_OWNER}/${REPO_NAME}`);
    console.log(`📍 Branch: ${BRANCH}`);
    console.log(`📍 Commit: ${commitSHA.substring(0, 8)}\n`);
    console.log('Next steps:');
    console.log(`1. npm install`);
    console.log(`2. npm run dev`);
    console.log(`\n✨ Your repository is ready!\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    // Skip .git, node_modules, etc.
    if (['.git', 'node_modules', '.next', 'dist', 'build', 'cache'].includes(file)) {
      return;
    }

    if (stat.isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else {
      fileList.push({
        path: fullPath,
        relative: path.relative(REPO_PATH, fullPath)
      });
    }
  });

  return fileList;
}

// Main
const token = process.argv[2];

if (!token) {
  console.log('Usage: node github-push.js <personal-access-token>\n');
  console.log('Get your token at: https://github.com/settings/tokens/new');
  console.log('Scopes needed: repo (full control of private repositories)\n');
  process.exit(1);
}

pushFilesToGitHub(token).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
