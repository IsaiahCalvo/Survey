#!/bin/bash

echo "Testing email function with detailed logging..."
echo ""

# Get the service role key for authorization
echo "Fetching service role key..."
SERVICE_KEY=$(supabase secrets list --project-ref cvamwtpsuvxvjdnotbeg 2>/dev/null | grep SUPABASE_SERVICE_ROLE_KEY | awk '{print $3}')

echo "Sending test email..."
curl -v -X POST "https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/send-email" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "isaiahcalvo0@gmail.com",
    "subject": "Debug Test - Email Delivery Check",
    "template": "subscription-canceled",
    "data": {
      "firstName": "Isaiah",
      "appUrl": "http://localhost:5173"
    }
  }' 2>&1

echo ""
echo ""
echo "Test complete! Check the response above for details."
