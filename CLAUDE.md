# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Development**: `npm run dev` - Start Vite development server with HMR
- **Build**: `npm run build` - TypeScript compilation followed by Vite build
- **Lint**: `npm run lint` - Run ESLint on the codebase
- **Preview**: `npm run preview` - Preview the production build locally

## Architecture

This is a React + TypeScript + Vite application with a simple datetime display component. The project structure follows standard Vite conventions:

- **Entry point**: `src/main.tsx` - Creates React root and renders the App component
- **Main component**: `src/App.tsx` - A datetime display component that updates every second using `useState` and `useEffect`
- **Styling**: Component-specific CSS in `src/App.css` with global styles in `src/index.css`
- **Build system**: Vite with React plugin for fast development and optimized builds
- **TypeScript**: Configured with separate configs for app (`tsconfig.app.json`) and build tools (`tsconfig.node.json`)

The application demonstrates basic React hooks usage with a real-time clock that formats both date and time using JavaScript's Intl API.