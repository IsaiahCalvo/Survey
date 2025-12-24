#!/bin/bash

echo "==========================================="
echo "STRIPE WEBHOOK VERIFICATION"
echo "==========================================="
echo ""

echo "1. Your Webhook Endpoint URL:"
echo "   https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook"
echo ""

echo "2. Webhook Endpoints in Stripe:"
echo "---"
stripe webhook_endpoints list | grep -E '"id"|"url"|"status"|"enabled_events"' | head -40
echo ""

echo "3. Recent Webhook Events (Last 10):"
echo "---"
stripe events list --limit 10 | grep -E '"id"|"type"|"created"|"delivered"' | head -40
echo ""

echo "4. Check Specific Subscription Events:"
echo "---"
echo "Enter your subscription ID (or press Enter to skip): "
read SUB_ID

if [ ! -z "$SUB_ID" ]; then
    echo "Events for subscription $SUB_ID:"
    stripe events list --type="customer.subscription.*" | grep -A5 -B5 "$SUB_ID" | head -30
fi

echo ""
echo "5. Test Webhook Endpoint:"
echo "---"
echo "Testing if webhook endpoint is reachable..."
curl -I "https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook" 2>&1 | head -5

echo ""
echo "==========================================="
echo "NEXT STEPS:"
echo "==========================================="
echo "1. Check if webhook URL matches in Stripe Dashboard"
echo "2. Verify webhook is enabled and not disabled"
echo "3. Check if events are being delivered (deliveries tab in Stripe)"
echo "4. Look for failed deliveries and error messages"
echo ""
