# Praxida

Praxida is a multi-tenant B2B SaaS application designed specifically for accounting firms and professional services teams to manage client deliverables, track critical deadlines, and organize team workflows. 

## 🚀 Key Features

*   **Multi-Tenant Architecture**: Robust data isolation using Supabase Row Level Security (RLS). Every piece of data (tasks, clients, profiles) is strictly scoped to its specific organization.
*   **Role-Based Access Control (RBAC)**:
    *   **Admins**: Can manage the entire organization, invite team members, view all tasks across the firm, and manage client profiles.
    *   **Members (Employees)**: Restricted view. They only see tasks explicitly assigned to them and cannot view the firm's client list or full team roster.
*   **Secure Authentication & Onboarding**:
    *   Real email verification required for all new accounts.
    *   Frictionless invite system: Admins generate secure invite codes that employees use during sign-up to automatically join the correct firm.
    *   Auto-recovery onboarding flow for incomplete signups.
*   **Task Management**: Create, assign, track, and complete tasks. Filter views by "All", "Pending", and "Completed".
*   **Client Management**: Maintain a directory of clients that tasks can be associated with.
*   **Modern, Responsive UI**: Built with a sleek, premium design system utilizing glassmorphism, subtle animations, and high-fidelity shimmer loading skeletons for seamless data fetching.
*   **Server Actions**: Secure, server-side data mutations in Next.js App Router for optimal performance and security.

## 🛠️ Technology Stack

*   **Frontend Framework**: Next.js 16 (App Router)
*   **Styling**: Tailwind CSS & custom CSS variables for easy theming
*   **Backend & Database**: Supabase (PostgreSQL)
*   **Authentication**: Supabase Auth (Email/Password)
*   **Icons**: Lucide React
*   **Date Formatting**: date-fns

## ⚙️ How It Runs Locally

To get the project running on your local machine, follow these steps:

### 1. Prerequisites
Ensure you have Node.js (v18+) and npm installed.

### 2. Environment Setup
Create a `.env.local` file in the root directory and add the following variables provided by your Supabase project:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```
*(Note: The `SUPABASE_SERVICE_ROLE_KEY` is used securely on the server for bypass-RLS operations like initial firm creation and invite code validation).*

### 3. Install Dependencies
```bash
npm install
```

### 4. Start the Development Server
```bash
npm run dev
```
The application will be available at [http://localhost:3000](http://localhost:3000).

## 🧪 Testing Credentials

To evaluate this project, sign up for your own Admin account via `/signup`, then generate an invite code from the dashboard to create a Member account and test the interaction between the two roles.

**1. Admin / Manager Account:**
*   Can create tasks, view all firm tasks, add clients, view the invite code, and manage firm settings.

**2. Employee / Member Account:**
*   Can only see tasks assigned specifically to them in the "My Tasks" view and mark them as complete.

### Testing the Workflow:
1. Log in as the Admin and create a new task assigned to the Employee.
2. Log out, then log in as the Employee to see the assigned task appear on the dashboard.
3. Mark the task as complete from the Employee account.
4. Log back in as the Admin to verify the task has moved to the "Completed" tab.

## 📁 Core Project Structure

*   `/src/app`: Next.js App Router pages and layouts.
    *   `/(auth)`: Login, signup, and onboarding routes.
    *   `/(dashboard)`: Protected routes (tasks, clients, team, settings).
*   `/src/components`: Reusable UI components (buttons, inputs, cards, sidebar, topbar).
*   `/src/lib`: Core utilities.
    *   `/supabase`: Client, server, and admin Supabase initialization clients.
    *   `auth.ts`: Centralized session and profile fetching helpers.
*   `/supabase`: Contains raw SQL files for database schema and RLS policies.
