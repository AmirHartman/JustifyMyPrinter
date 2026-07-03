# מדפסת חברים — Project Context

## Purpose
This file is the shared context source for the ChatGPT Project “מדפסת חברים”. Use it when discussing product decisions, prompts for coding agents, bugs, architecture, and feature planning.

## Project names
- Hebrew name: מדפסת חברים
- Current repo/app name: JustifyMyPrinter

## What the app is
“מדפסת חברים” is a real web app for managing 3D-printing requests for friends. It is not just a landing page and not just a shop. It should become a small operating system around the owner’s 3D printer: catalog, orders, friends, admin dashboard, costs, revenue, expenses, and eventually filament inventory.

## Main vision
The app helps the admin:
- manage print orders and requests;
- track order status and payments;
- manage products and categories;
- track income, expenses, and profit;
- show transparent support/reinvestment to friends;
- learn whether this can become a public paid business in the future.

## Business model
The central model is: **transparent base cost + optional extra support**.

Friends should see the base cost and understand that extra support is reinvested into the project: new filament colors, printer parts, paid models, maintenance, accessories, and future improvements.

## Users
### Public visitor
Can see the landing/explanation page and public catalog. Cannot order.

### Registered friend
Can log in, view catalog, order, see personal area, order history, statuses, payments, approve special-order prices, cancel orders before printing, and contact the admin via WhatsApp.

### Admin
Single admin: the owner. Can manage users, products, orders, categories, costs, income, expenses, and WhatsApp communication. Admin can also use the site as a normal user named Amir and place personal orders so personal prints are counted in material usage.

## Current project state
The codebase already exists and currently includes:
- Neon database connection;
- registration/login;
- admin user;
- catalog/products;
- orders;
- user personal area;
- admin area;
- product management;
- Vercel deployment;
- an internal messaging system that should be removed.

There are conceptual flow issues. The current spec should be used to align the existing project.

## Important decision: WhatsApp replaces internal messages
Internal site messaging and automated notifications are cancelled for now, not just postponed.

The app should use WhatsApp as the main communication channel:
- WhatsApp buttons in admin user profiles;
- WhatsApp buttons near orders;
- prefilled message templates for status updates, price approval, delivery coordination, and payment summaries;
- no WhatsApp API in MVP, only manual sending through WhatsApp/WhatsApp Web.

Existing internal messaging UI/data flows should be removed or disabled and replaced with WhatsApp links/templates.

## Language and UX
- Hebrew-only UI for MVP.
- Mostly RTL.
- Technical strings, URLs, file names, and identifiers may remain LTR.
- Tone: friendly, personal, a bit funny, professional, clean, transparent, community-like, colorful and fun.
- Mobile-friendly design is required.

## Printer context
When the user says “my printer”, assume: **Bambu Lab P2S Combo with AMS 2 Pro**, unless stated otherwise.

## AI prompt preference
When generating prompts for Claude Code, Codex, or other coding/build agents:
- write prompts in English;
- keep them as token-efficient as possible;
- include only relevant context;
- preserve Hebrew RTL, Neon, free-tier constraints, and no paid services without approval.
