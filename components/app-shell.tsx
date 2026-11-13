"use client";
import { useConvexAuth, useConvexConnectionState } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, FileSpreadsheet, LayoutDashboard, LogOut, Network, ShieldCheck, Users, Wallet } from "lucide-react";
export function AppShell({ children }: { children: React.ReactNode }) {
  const { isLoading,isAuthenticated }=useConvexAuth();
  const connection=useConvexConnectionState();
  const {signOut}=useAuthActions();const router=useRouter();const pathname=usePathname();
  const [error,setError]=useState("");const [signingOut,setSigningOut]=useState(false);
  useEffect(()=>{if(!isLoading&&!isAuthenticated)router.replace("/sign-in");},[isLoading,isAuthenticated,router]);
  if(signingOut||isLoading||!isAuthenticated)return <main className="muted p-12" role="status">{signingOut?"Signing out…":"Checking your session…"}</main>;
  const section=pathname==="/dashboard"?"Dashboard":pathname==="/economy"?"Live economy":pathname==="/payments"?"Payments":pathname==="/security"?"Security lab":pathname==="/agents"?"Agent directory":pathname.startsWith("/agents")?"Agent profile":pathname==="/missions"?"Missions":pathname==="/missions/new"?"New mission":"Mission workspace";
  return <div className="workspace-app">
    <a href="#workspace-main" className="skip-link">Skip to workspace</a>
    <aside className="workspace-sidebar" aria-label="Workspace sidebar">
      <div className="sidebar-brand"><Brand href="/dashboard"/></div><p className="sidebar-workspace">Personal workspace / testnet</p>
      <p className="sidebar-label">Workspace</p>
      <nav className="workspace-nav" aria-label="Main navigation">{[
        {href:"/dashboard",label:"Dashboard",Icon:LayoutDashboard,active:pathname==="/dashboard"},
        {href:"/missions",label:"Missions",Icon:FileSpreadsheet,active:pathname.startsWith("/missions")},
        {href:"/economy",label:"Economy",Icon:Network,active:pathname==="/economy"},
        {href:"/payments",label:"Payments",Icon:Wallet,active:pathname==="/payments"},
        {href:"/agents",label:"Agent directory",Icon:Users,active:pathname.startsWith("/agents")},
        {href:"/security",label:"Security",Icon:ShieldCheck,active:pathname==="/security"},
      ].map(({href,label,Icon,active})=><Link href={href} key={label} className={active?"selected":""} aria-current={active?"page":undefined}><Icon size={18} aria-hidden="true"/><span>{label}</span></Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="network-label">NEAR testnet</span><p>Real data processing.<br/>Test tokens only.</p><Link href="/">About GuildZero <ArrowUpRight size={12}/></Link></div>
      <button className="sidebar-signout" aria-label="Sign out" onClick={async()=>{try{flushSync(()=>setSigningOut(true));await signOut();router.replace("/sign-in");}catch{setSigningOut(false);setError("Could not sign out. Try again.");}}}><LogOut size={17}/><span>Sign out</span></button></div>
    </aside>
    <div className="workspace-body"><header className="app-topbar"><nav aria-label="Workspace location"><Link href="/dashboard">Workspace</Link><span aria-hidden="true">/</span><span>{section}</span></nav><div className="app-topbar-actions"><span className={`connection-status ${connection.isWebSocketConnected?"connected":""}`}>{connection.isWebSocketConnected?"Live updates":"Connecting"}</span><Button asChild variant="outline"><Link href="/missions/new">New mission <ArrowUpRight size={14}/></Link></Button></div></header>
      <div className="workspace-page">
        {connection.hasEverConnected&&!connection.isWebSocketConnected&&<p role="status" className="connection-warning">Reconnecting to your workspace. Changes will sync when the connection returns.</p>}
        {error&&<p role="alert" className="text-red-800 mb-4">{error}</p>}
        <main id="workspace-main" tabIndex={-1}>{children}</main>
        <footer className="workspace-footer"><span>GuildZero · Private mission workspace</span><span>Algorithm-driven agents · Custodial testnet payments</span></footer>
      </div>
    </div>
  </div>;
}
