# GitHub Setup Instructions

## Step 1: Create a Repository on GitHub

1. Go to https://github.com/new
2. Fill in:
   - **Repository name**: `smallcap-radar`
   - **Description**: Small-Cap Radar — Arabic stock screener for US market
   - **Public/Private**: Choose based on your preference
   - **Do NOT** initialize with README (we have one already)
3. Click "Create repository"

## Step 2: Connect Local Repo to GitHub

```bash
cd /home/claude/smallcap-radar

# Add GitHub as remote
git remote add origin https://github.com/[YOUR_USERNAME]/smallcap-radar.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

## Step 3: Verify

Visit https://github.com/[YOUR_USERNAME]/smallcap-radar

You should see:
- All files and folders
- Commit history (1 commit)
- README.md displayed on the repo homepage

## Step 4: (Optional) Connect to Higgsfield

If you want Higgsfield to auto-deploy from GitHub:

1. In Higgsfield settings, connect your GitHub account
2. Link this repo as the source for smallcap-radar
3. Higgsfield will build and deploy on every push

---

**That's it!** Your project is now on GitHub and ready for version control.
