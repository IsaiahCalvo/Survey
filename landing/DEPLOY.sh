#!/bin/bash

echo "=================================="
echo "Survey Landing Page - Vercel Deployment"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "index.html" ]; then
    echo "❌ Error: Must run from the landing directory"
    echo "Run: cd /Users/isaiahcalvo/Desktop/Survey/landing"
    exit 1
fi

echo "✅ Found landing page files"
echo ""

# Check if logged in to Vercel
echo "Checking Vercel authentication..."
vercel whoami 2>&1 | grep -q "Error" && LOGGED_IN=false || LOGGED_IN=true

if [ "$LOGGED_IN" = false ]; then
    echo ""
    echo "🔐 You need to log in to Vercel first."
    echo ""
    echo "I'll open the login process now. You'll need to:"
    echo "  1. Choose 'Continue with Email' or 'Continue with GitHub'"
    echo "  2. Complete authentication in your browser"
    echo "  3. Return to this terminal"
    echo ""
    read -p "Press Enter to log in to Vercel..."

    vercel login

    if [ $? -ne 0 ]; then
        echo "❌ Login failed. Please try again."
        exit 1
    fi

    echo ""
    echo "✅ Successfully logged in to Vercel!"
    echo ""
fi

# Deploy
echo "🚀 Deploying to Vercel..."
echo ""

vercel --prod --yes

if [ $? -eq 0 ]; then
    echo ""
    echo "=================================="
    echo "✅ Deployment Successful!"
    echo "=================================="
    echo ""
    echo "Your landing page is now live!"
    echo ""
    echo "Next steps:"
    echo "1. Copy the deployment URL above"
    echo "2. Share it with Claude"
    echo "3. Claude will verify the domain in Resend"
    echo "4. Emails will work for all users!"
    echo ""
else
    echo ""
    echo "❌ Deployment failed"
    echo "Try running: vercel --prod"
    echo ""
fi
