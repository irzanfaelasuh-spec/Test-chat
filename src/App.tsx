import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  addDoc, arrayUnion, collection, deleteDoc, doc, getDoc, limit,
  onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc,
  where
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword,
  signOut, type User
} from 'firebase/auth';
import {
  getDownloadURL, ref, uploadBytes, uploadBytesResumable
} from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft, ArrowUpRight, AudioLines, Bell, Camera, Check, CheckCheck,
  ChevronRight, Clipboard, File, FilePlus2, Image, Info, Lock, LogOut,
  MessageCircle, Mic, Paperclip, Pencil, Plus, Search, Send, Settings,
  Shield, Sparkles, Sticker, Trash2, UserPlus, Users, Video, X,
  CheckCircle2, CircleUserRound, Ban, LoaderCircle, Hash, Phone, Reply,
  ImagePlus, Eye, EyeOff, CircleDot, ShieldCheck
} from 'lucide-react';
import { auth, db, firebaseReady, functions, storage } from './firebase';

type Profile = {
  uid: string; username: string; displayName: string; number: string;
  avatarUrl?: string; about?: string; online?: boolean; lastSeen?: any;
};
type Contact = {
  uid: string; number: string; username: string; displayName: string;
  avatarUrl?: string; shortName: string; fullName: string; about?: string;
};
type Conversation = {
  id: string; type: 'direct' | 'group'; members: string[]; admins?: string[];
  groupName?: string; groupAbout?: string; groupAvatarUrl?: string;
  createdBy?: string; updatedAt?: any; lastMessage?: any;
};
type ChatMessage = {
  id: string; senderId: string; text?: string; type: string; mediaUrl?: string;
  mediaName?: string; mediaSize?: number; createdAt?: any; editedAt?: any;
  deletedForEveryone?: boolean; deletedBy?: string; reactions?: Record<string, string>;
  readBy?: string[]; deliveredTo?: string[]; replyTo?: string;
};
type Notice = { id: number; text: string; kind?: 'error' | 'success' };

const usernameEmail = (username: string) => `${username.trim().toLowerCase()}@account.veyra.chat`;
const call = <T,>(name: string, data: unknown) => httpsCallable<unknown, T>(functions, name)(data).then((r) => r.data);
const initials = (value = '') => value.trim().split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || 'V';
const idOf = () => Math.random().toString(36).slice(2, 11);

const tokenDocumentId = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const formatTime = (stamp: any) => {
  const date = stamp?.toDate ? stamp.toDate() : stamp instanceof Date ? stamp : null;
  return date ? date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
};
const formatBytes = (size = 0) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const explainError = (error: any) => {
  const code = String(error?.code || '');
  if (code.includes('email-already-in-use')) return 'Username sudah digunakan.';
  if (code.includes('user-not-found') || code.includes('invalid-credential')) return 'Username atau password salah.';
  if (code.includes('weak-password')) return 'Password minimal 8 karakter.';
  if (code.includes('permission-denied')) return error?.message || 'Akses ditolak. Periksa aturan Firebase.';
  if (code.includes('functions/')) return error?.message || 'Layanan belum siap. Periksa Cloud Functions.';
  return error?.message || 'Terjadi kesalahan. Coba lagi.';
};

function Avatar({ name, src, size = 'md', online = false }: { name: string; src?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; online?: boolean }) {
  return <span className={`avatar avatar-${size}`}>
    {src ? <img src={src} alt="" /> : <b>{initials(name)}</b>}
    {online && <i className="online-dot" />}
  </span>;
}

function Brand() {
  return <div className="brand-mark"><span className="brand-glyph">v</span><span>veyra</span></div>;
}

function AuthScreen({ notify, onAuthenticated }: { notify: (text: string, kind?: 'error' | 'success') => void; onAuthenticated: (profile: Profile) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const canSubmit = username.trim().length >= 3 && password.length >= 8 && (mode === 'login' || displayName.trim().length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || busy) return;
    const normalized = username.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,20}$/.test(normalized)) return notify('Username 3–20 karakter: huruf, angka, titik, atau garis bawah.', 'error');
    if (mode === 'signup' && displayName.trim().length > 20) return notify('Nama tampilan maksimal 20 karakter.', 'error');
    setBusy(true);
    try {
      let profileResult: { profile: Profile };
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, usernameEmail(normalized), password);
        try {
          profileResult = await call<{ profile: Profile }>('createProfile', { username: normalized, displayName: displayName.trim() });
        } catch (error) {
          await credential.user.delete();
          throw error;
        }
      } else {
        await signInWithEmailAndPassword(auth, usernameEmail(normalized), password);
        profileResult = await call<{ profile: Profile }>('createProfile', { username: normalized, displayName: normalized });
      }
      onAuthenticated(profileResult.profile);
      notify(mode === 'signup' ? 'Akun berhasil dibuat.' : 'Berhasil masuk.', 'success');
    } catch (error) {
      notify(explainError(error), 'error');
    } finally { setBusy(false); }
  };

  return <main className="auth-screen">
    <div className="auth-orb orb-one" /><div className="auth-orb orb-two" />
    <div className="auth-top"><Brand /><span className="secure-tag"><Shield size={13} /> Firebase secured</span></div>
    <section className="auth-card">
      <div className="auth-intro"><div className="auth-icon"><MessageCircle size={25} /></div>
        <p className="eyebrow">YOUR SPACE TO CONNECT</p>
        <h1>Conversations,<br /><em>without the noise.</em></h1>
        <p className="muted">A quieter place for the people who matter.</p>
      </div>
      <div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button></div>
      <form onSubmit={submit} className="auth-form">
        {mode === 'signup' && <label className="field"><span>Display name</span><input value={displayName} maxLength={20} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" autoComplete="nickname" /><small>{displayName.length}/20</small></label>}
        <label className="field"><span>Username</span><input value={username} maxLength={20} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_.]/g, ''))} placeholder="e.g. irzan" autoComplete="username" /></label>
        <label className="field"><span>Password</span><div className="password-wrap"><input value={password} onChange={(e) => setPassword(e.target.value)} type={showPassword ? 'text' : 'password'} placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /><button type="button" className="icon-btn" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
        <button className="primary-btn auth-submit" disabled={!canSubmit || busy}>{busy ? <><LoaderCircle className="spin" size={17} /> Please wait</> : <>{mode === 'login' ? 'Enter Veyra' : 'Create account'} <ArrowUpRight size={17} /></>}</button>
      </form>
      <div className="auth-foot"><Lock size={12} /> Your password is protected by Firebase Authentication.</div>
    </section>
    <footer className="auth-footer">VEYRA MESSAGING <span>·</span> MADE FOR REAL CONNECTIONS</footer>
  </main>;
}

function PrepareScreen() {
  return <div className="prepare-screen"><div className="prepare-logo"><Brand /></div><div className="prepare-ring"><span /><span /><span /></div><h2>Prepare your account...</h2><p>Setting up your conversations and syncing your space.</p><div className="prepare-progress"><i /></div><small>SECURE SESSION INITIALIZATION</small></div>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [tab, setTab] = useState<'chats' | 'updates' | 'contacts' | 'settings'>('chats');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'add' | 'group' | 'profile' | 'groupInfo' | 'status' | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [chatPrefill, setChatPrefill] = useState('');

  const notify = useCallback((text: string, kind: 'error' | 'success' = 'success') => {
    const id = Date.now() + Math.random();
    setNotices((old) => [...old, { id, text, kind }]);
    window.setTimeout(() => setNotices((old) => old.filter((item) => item.id !== id)), 3800);
  }, []);

  const profileIds = useMemo(() => {
    if (!user) return '';
    return [...new Set([
      ...conversations.flatMap((c) => c.members.filter((id) => id !== user.uid)),
      ...contacts.map((contact) => contact.uid)
    ])].sort().join('|');
  }, [conversations, contacts, user?.uid]);

  useEffect(() => onAuthStateChanged(auth, async (current) => {
    setUser(current);
    if (!current) { setProfile(null); setPreparing(false); setAuthLoading(false); setContacts([]); setConversations([]); setProfiles({}); setBlockedUsers([]); setActiveConversationId(null); setMobileChatOpen(false); return; }
    setPreparing(true);
    window.setTimeout(() => setPreparing(false), 5000);
    try {
      const snap = await getDoc(doc(db, 'users', current.uid));
      if (snap.exists()) setProfile({ uid: current.uid, ...snap.data() } as Profile);
    } catch (error) { notify(explainError(error), 'error'); }
    setAuthLoading(false);
  }), [notify]);

  useEffect(() => {
    if (!user || profile) return;
    let mounted = true;
    getDoc(doc(db, 'users', user.uid)).then((snap) => { if (mounted && snap.exists()) setProfile({ uid: user.uid, ...snap.data() } as Profile); });
    return () => { mounted = false; };
  }, [user, profile]);


  useEffect(() => {
    if (!user || !profile) return;
    const q = query(collection(db, 'users', user.uid, 'contacts'), orderBy('fullName'));
    return onSnapshot(q, (snapshot) => setContacts(snapshot.docs.map((d) => ({ uid: d.id, ...d.data() } as Contact))), (error) => notify(explainError(error), 'error'));
  }, [user, profile, notify]);

  useEffect(() => {
    if (!user || !profile) return;
    const q = query(collection(db, 'conversations'), where('members', 'array-contains', user.uid), orderBy('updatedAt', 'desc'), limit(100));
    return onSnapshot(q, (snapshot) => {
      setConversations(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Conversation)));
    }, (error) => notify(explainError(error), 'error'));
  }, [user, profile, notify]);

  useEffect(() => {
    if (!user || !profileIds) { setProfiles({}); return; }
    const ids = profileIds.split('|');
    const unsubscribers = ids.map((id) => onSnapshot(doc(db, 'users', id), (snap) => {
      if (snap.exists()) setProfiles((old) => ({ ...old, [id]: { uid: id, ...snap.data() } as Profile }));
      else setProfiles((old) => { const next = { ...old }; delete next[id]; return next; });
    }, (error) => notify(explainError(error), 'error')));
    return () => unsubscribers.forEach((off) => off());
  }, [user, profileIds, notify]);

  useEffect(() => {
    if (!user) return;
    const q = collection(db, 'users', user.uid, 'blocks');
    return onSnapshot(q, (snap) => setBlockedUsers(snap.docs.map((d) => d.id)));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const syncPresence = () => call('setUserOnline', { online: document.visibilityState === 'visible' }).catch(() => {});
    const onPageHide = () => call('setUserOnline', { online: false }).catch(() => {});
    syncPresence();
    document.addEventListener('visibilitychange', syncPresence);
    window.addEventListener('pagehide', onPageHide);
    return () => { document.removeEventListener('visibilitychange', syncPresence); window.removeEventListener('pagehide', onPageHide); call('setUserOnline', { online: false }).catch(() => {}); };
  }, [user]);

  useEffect(() => {
    if (!user || !Capacitor.isNativePlatform()) return;
    let active = true;
    const register = async () => {
      try {
        let permission = await PushNotifications.checkPermissions();
        if (permission.receive !== 'granted') permission = await PushNotifications.requestPermissions();
        if (!active || permission.receive !== 'granted') return;
        await PushNotifications.createChannel({ id: 'veyra_messages', name: 'Messages', description: 'New chat messages', importance: 5, sound: 'default', vibration: true });
        await PushNotifications.register();
      } catch (error) { console.info('Push setup:', error); }
    };
    const tokenListener = PushNotifications.addListener('registration', async ({ value }) => {
      try { const deviceId = await tokenDocumentId(value); await setDoc(doc(db, 'users', user.uid, 'devices', deviceId), { token: value, updatedAt: serverTimestamp() }); }
      catch (error) { console.error(error); }
    });
    const receivedListener = PushNotifications.addListener('pushNotificationReceived', ({ title, body }) => {
      notify([title, body].filter(Boolean).join(' · ') || 'New message');
    });
    const actionListener = PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const conversationId = notification.data?.conversationId;
      if (typeof conversationId === 'string') { setActiveConversationId(conversationId); setMobileChatOpen(true); setTab('chats'); }
    });
    register();
    return () => { active = false; tokenListener.then((l) => l.remove()); receivedListener.then((l) => l.remove()); actionListener.then((l) => l.remove()); };
  }, [user]);

  const contactByUid = useMemo(() => Object.fromEntries(contacts.map((c) => [c.uid, c])), [contacts]);
  const activeConversation = conversations.find((c) => c.id === activeConversationId) || null;

  const logout = async () => {
    try { if (user) await call('setUserOnline', { online: false }); await signOut(auth); setActiveConversationId(null); setMobileChatOpen(false); }
    catch (error) { notify(explainError(error), 'error'); }
  };

  const openChat = async (contact: Contact, status?: any) => {
    try {
      const result = await call<{ conversationId: string }>('openDirectChat', { targetUid: contact.uid });
      setActiveConversationId(result.conversationId); setMobileChatOpen(true); setTab('chats');
      setChatPrefill(status ? `Replying to status: ${status.text || (status.type === 'video' ? 'Video' : 'Photo')}\n` : '');
    } catch (error) { notify(explainError(error), 'error'); }
  };

  const conversationTitle = (c: Conversation) => {
    if (c.type === 'group') return c.groupName || 'Untitled group';
    const other = c.members.find((id) => id !== user?.uid) || '';
    const contact = contactByUid[other];
    return contact?.shortName || contact?.fullName || profiles[other]?.displayName || profiles[other]?.username || 'Veyra user';
  };
  const conversationAvatar = (c: Conversation) => c.type === 'group' ? c.groupAvatarUrl : profiles[c.members.find((id) => id !== user?.uid) || '']?.avatarUrl;
  const filteredConversations = conversations.filter((c) => conversationTitle(c).toLowerCase().includes(search.toLowerCase()));

  if (!firebaseReady) return <div className="config-screen"><Brand /><h1>One small setup step.</h1><p>Tambahkan konfigurasi Firebase ke file <code>.env.local</code> lalu jalankan ulang aplikasi.</p><pre>{'cp .env.example .env.local'}</pre><p>Isi enam nilai Firebase Web App dari Firebase Console. Petunjuk lengkap ada di README.</p></div>;
  if (authLoading) return <div className="boot-screen"><Brand /><LoaderCircle className="spin" size={24} /></div>;
  if (!user) return <><AuthScreen notify={notify} onAuthenticated={setProfile} /><NoticeStack notices={notices} /></>;
  if (!profile) return <div className="boot-screen"><Brand /><LoaderCircle className="spin" size={24} /><span>Preparing account...</span><button className="text-action" onClick={() => signOut(auth)}>Back to login</button><NoticeStack notices={notices} /></div>;
  if (preparing) return <PrepareScreen />;

  return <div className="app-shell">
    <aside className="rail">
      <div className="rail-brand"><span className="brand-glyph">v</span></div>
      <div className="rail-nav">
        <button className={tab === 'chats' ? 'selected' : ''} onClick={() => { setTab('chats'); setMobileChatOpen(false); }} title="Chats"><MessageCircle size={20} /><span>Chats</span></button>
        <button className={tab === 'updates' ? 'selected' : ''} onClick={() => { setTab('updates'); setMobileChatOpen(false); }} title="Updates"><CircleDot size={20} /><span>Updates</span></button>
        <button className={tab === 'contacts' ? 'selected' : ''} onClick={() => { setTab('contacts'); setMobileChatOpen(false); }} title="Contacts"><Users size={20} /><span>Contacts</span></button>
      </div>
      <div className="rail-bottom">
        <button className={tab === 'settings' ? 'selected' : ''} onClick={() => { setTab('settings'); setMobileChatOpen(false); }} title="Settings"><Settings size={20} /><span>Settings</span></button>
        <button className="rail-avatar" onClick={() => setModal('profile')} title="Profile"><Avatar name={profile.displayName} src={profile.avatarUrl} size="sm" /></button>
      </div>
    </aside>

    <main className={`main-pane ${mobileChatOpen ? 'mobile-hidden' : ''}`}>
      {tab === 'chats' && <>
        <div className="pane-header"><div><p className="eyebrow">YOUR MESSAGES</p><h1>Chats <span className="count-pill">{conversations.length}</span></h1></div><div className="header-actions"><button className="round-btn" onClick={() => setModal('group')} title="New group"><Users size={17} /></button><button className="round-btn active" onClick={() => setModal('add')} title="Add contact"><Plus size={19} /></button></div></div>
        <div className="search-box"><Search size={16} /><input placeholder="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} /><kbd>⌘ K</kbd></div>
        <div className="list-caption"><span>RECENT</span><span>{conversations.length} CONVERSATIONS</span></div>
        <div className="conversation-list">
          {filteredConversations.map((c) => <button key={c.id} className={`conversation-row ${c.id === activeConversationId ? 'active' : ''}`} onClick={() => { setActiveConversationId(c.id); setMobileChatOpen(true); }}>
            <Avatar name={conversationTitle(c)} src={conversationAvatar(c)} size="lg" online={c.type === 'direct' && !!profiles[c.members.find((id) => id !== user.uid) || '']?.online} />
            <span className="conversation-copy"><b>{conversationTitle(c)}</b><small>{c.lastMessage?.deletedForEveryone ? 'Message deleted' : c.lastMessage?.text || (c.lastMessage?.type ? `${c.lastMessage.type} message` : 'Start a conversation')}</small></span>
            <span className="conversation-meta"><small>{formatTime(c.updatedAt)}</small>{c.lastMessage?.unreadCount > 0 && <i className="unread-dot" />}</span>
          </button>)}
          {!filteredConversations.length && <EmptyState icon={<MessageCircle size={23} />} title={search ? 'No results found' : 'Your space is clear'} text={search ? 'Try another name.' : 'Add a contact to start your first conversation.'} action={!search ? <button className="text-action" onClick={() => setModal('add')}>Add your first contact <ArrowUpRight size={14} /></button> : null} />}
        </div>
      </>}
      {tab === 'updates' && <UpdatesView user={user} profile={profile} contacts={contacts} profiles={profiles} notify={notify} onNew={() => setModal('status')} onReply={openChat} />}
      {tab === 'contacts' && <ContactsView contacts={contacts} profiles={profiles} onAdd={() => setModal('add')} onChat={openChat} onGroup={() => setModal('group')} />}
      {tab === 'settings' && <SettingsView profile={profile} user={user} blockedUsers={blockedUsers} notify={notify} onProfile={() => setModal('profile')} onLogout={logout} onUnblock={async (uid) => { try { await call('setBlock', { targetUid: uid, blocked: false }); notify('User unblocked.'); } catch (e) { notify(explainError(e), 'error'); } }} profiles={profiles} />}
    </main>

    {tab === 'chats' && <section className={`chat-pane ${mobileChatOpen ? 'mobile-show' : ''}`}>
      {activeConversation ? <ChatView key={activeConversation.id} conversation={activeConversation} user={user} profile={profile} title={conversationTitle(activeConversation)} avatar={conversationAvatar(activeConversation)} contacts={contacts} profiles={profiles} notify={notify} initialDraft={chatPrefill} onInitialDraftConsumed={() => setChatPrefill('')} onBack={() => setMobileChatOpen(false)} onGroupInfo={() => setModal('groupInfo')} /> : <div className="chat-empty"><div className="empty-illustration"><div className="empty-ring"><MessageCircle size={42} /></div><span className="float-dot dot-a"/><span className="float-dot dot-b"/><span className="float-dot dot-c"/></div><h2>A little more connected.</h2><p>Choose a conversation or add someone new to say hello.</p><button className="primary-btn" onClick={() => setModal('add')}><UserPlus size={17} /> Add contact</button><div className="empty-encryption"><ShieldCheck size={14} /> Only members of a conversation can open its messages.</div></div>}
    </section>}

    {modal === 'add' && <AddContactModal user={user} notify={notify} onClose={() => setModal(null)} onAdded={(contact) => { setModal(null); openChat(contact); }} />}
    {modal === 'group' && <CreateGroupModal contacts={contacts} profiles={profiles} user={user} notify={notify} onClose={() => setModal(null)} onCreated={(id) => { setModal(null); setTab('chats'); setActiveConversationId(id); setMobileChatOpen(true); }} />}
    {modal === 'profile' && <ProfileModal user={user} profile={profile} notify={notify} onClose={() => setModal(null)} onSaved={(p) => setProfile(p)} />}
    {modal === 'groupInfo' && activeConversation?.type === 'group' && <GroupInfoModal conversation={activeConversation} user={user} contacts={contacts} profiles={profiles} notify={notify} onClose={() => setModal(null)} />}
    {modal === 'status' && <CreateStatusModal user={user} notify={notify} onClose={() => setModal(null)} />}
    <NoticeStack notices={notices} />
  </div>;
}

function NoticeStack({ notices }: { notices: Notice[] }) {
  return <div className="notice-stack">{notices.map((n) => <div className={`notice ${n.kind || ''}`} key={n.id}><span>{n.kind === 'error' ? <Info size={15} /> : <CheckCircle2 size={15} />}</span>{n.text}</div>)}</div>;
}
function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div>{icon}</div><b>{title}</b><p>{text}</p>{action}</div>;
}

function AddContactModal({ user, notify, onClose, onAdded }: { user: User; notify: (t: string, k?: 'error' | 'success') => void; onClose: () => void; onAdded: (c: Contact) => void }) {
  const [number, setNumber] = useState('');
  const [shortName, setShortName] = useState('');
  const [fullName, setFullName] = useState('');
  const [found, setFound] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const lookup = async () => {
    if (!/^\d{10}$/.test(number)) return notify('Masukkan nomor Veyra 10 digit.', 'error');
    setBusy(true);
    try { const result = await call<any>('lookupByNumber', { number }); setFound(result); setShortName(result.displayName.slice(0, 16)); setFullName(result.displayName.slice(0, 32)); }
    catch (e) { notify(explainError(e), 'error'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!found || !shortName.trim() || !fullName.trim()) return;
    setBusy(true);
    try {
      const contact = { ...found, shortName: shortName.trim(), fullName: fullName.trim(), addedAt: serverTimestamp() };
      await setDoc(doc(db, 'users', user.uid, 'contacts', found.uid), contact);
      const chat = await call<{ conversationId: string }>('openDirectChat', { targetUid: found.uid });
      notify('Contact added successfully.');
      onAdded({ ...contact, uid: found.uid } as Contact);
      // The chat id is created here so the next action opens immediately.
      void chat;
    } catch (e) { notify(explainError(e), 'error'); }
    finally { setBusy(false); }
  };
  return <ModalShell title="Add contact" subtitle="Find someone using their unique Veyra number." onClose={onClose}>
    {!found ? <div className="modal-form"><label className="field"><span>Veyra number</span><div className="number-field"><Hash size={16} /><input autoFocus value={number} maxLength={10} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))} placeholder="10 digit number" inputMode="numeric" /></div><small>{number.length}/10</small></label><button className="primary-btn full" disabled={busy || number.length !== 10} onClick={lookup}>{busy ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />} Search account</button></div> : <div className="contact-confirm"><Avatar name={found.displayName} src={found.avatarUrl} size="xl" /><h3>{found.displayName}</h3><p>@{found.username} <span>·</span> {found.number}</p><div className="form-divider" /><label className="field"><span>Short name</span><input value={shortName} maxLength={16} onChange={(e) => setShortName(e.target.value)} /><small>{shortName.length}/16</small></label><label className="field"><span>Full name</span><input value={fullName} maxLength={32} onChange={(e) => setFullName(e.target.value)} /><small>{fullName.length}/32</small></label><div className="modal-actions"><button className="secondary-btn" onClick={() => setFound(null)}>Back</button><button className="primary-btn" disabled={busy || !shortName.trim() || !fullName.trim()} onClick={save}>{busy ? <LoaderCircle className="spin" size={16} /> : <><UserPlus size={16} /> Add contact</>}</button></div></div>}
  </ModalShell>;
}

function CreateGroupModal({ contacts, profiles, user, notify, onClose, onCreated }: { contacts: Contact[]; profiles: Record<string, Profile>; user: User; notify: (t: string, k?: 'error' | 'success') => void; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const create = async () => {
    if (!name.trim() || !selected.length) return;
    setBusy(true);
    try {
      const result = await call<{ conversationId: string }>('createGroup', { name: name.trim(), about, memberUids: selected });
      if (avatarFile) {
        const compressed = await optimizeImage(avatarFile, 800, 0.78);
        const path = `chats/${result.conversationId}/${user.uid}/group-${Date.now()}.jpg`;
        const upload = await uploadBytes(ref(storage, path), compressed, { contentType: 'image/jpeg' });
        await call('manageGroup', { conversationId: result.conversationId, action: 'metadata', groupAvatarUrl: await getDownloadURL(upload.ref) });
      }
      notify('Group created. You are the admin.'); onCreated(result.conversationId);
    } catch (e) { notify(explainError(e), 'error'); }
    finally { setBusy(false); }
  };
  return <ModalShell title="Create a group" subtitle="Bring your people together." onClose={onClose}>
    <div className="modal-form"><label className="group-avatar-upload"><input type="file" accept="image/*" onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} /><span>{avatarFile ? <Image size={22} /> : <ImagePlus size={22} />}</span><small>{avatarFile ? avatarFile.name : 'Add group photo (optional)'}</small></label><label className="field"><span>Group name</span><input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Void"/><small>{name.length}/24</small></label><label className="field"><span>Group description</span><input value={about} maxLength={80} onChange={(e) => setAbout(e.target.value)} placeholder="What is this group about?"/><small>{about.length}/80</small></label><div className="select-people-heading"><b>Add people</b><span>{selected.length} selected</span></div><div className="people-select-list">{contacts.map((c) => <label className="people-select-row" key={c.uid}><Avatar name={c.shortName} src={profiles[c.uid]?.avatarUrl || c.avatarUrl} /><span><b>{c.shortName}</b><small>{c.fullName}</small></span><input type="checkbox" checked={selected.includes(c.uid)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, c.uid] : old.filter((id) => id !== c.uid))}/></label>)}{!contacts.length && <p className="empty-hint">Add contacts before creating a group.</p>}</div><button className="primary-btn full" onClick={create} disabled={busy || !name.trim() || !selected.length}>{busy ? <LoaderCircle className="spin" size={16} /> : <><Users size={16} /> Create group</>}</button></div>
  </ModalShell>;
}

function ProfileModal({ user, profile, notify, onClose, onSaved }: { user: User; profile: Profile; notify: (t: string, k?: 'error' | 'success') => void; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [name, setName] = useState(profile.displayName || '');
  const [about, setAbout] = useState(profile.about || '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim() || name.trim().length > 20) return notify('Nama harus 1–20 karakter.', 'error');
    setBusy(true);
    try {
      let avatarUrl = profile.avatarUrl || '';
      if (file) {
        const compressed = await optimizeImage(file, 900, 0.8);
        const upload = await uploadBytes(ref(storage, `avatars/${user.uid}/avatar-${Date.now()}.jpg`), compressed, { contentType: 'image/jpeg' });
        avatarUrl = await getDownloadURL(upload.ref);
      }
      await updateDoc(doc(db, 'users', user.uid), { displayName: name.trim(), about: about.trim().slice(0, 80), avatarUrl, updatedAt: serverTimestamp() });
      onSaved({ ...profile, displayName: name.trim(), about: about.trim().slice(0, 80), avatarUrl });
      notify('Profile updated. Your photo is visible to everyone.'); onClose();
    } catch (e) { notify(explainError(e), 'error'); }
    finally { setBusy(false); }
  };
  return <ModalShell title="Your profile" subtitle="Your photo is public. Your display name is shown to people who have not saved you." onClose={onClose}>
    <div className="profile-editor"><label className="profile-photo-picker"><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /><Avatar name={name} src={file ? URL.createObjectURL(file) : profile.avatarUrl} size="xl"/><span><Camera size={14}/></span></label><p className="subtle-center">Tap photo to change it</p><label className="field"><span>Display name</span><input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} /><small>{name.length}/20</small></label><label className="field"><span>About</span><input value={about} maxLength={80} onChange={(e) => setAbout(e.target.value)} /><small>{about.length}/80</small></label><div className="profile-id"><span>YOUR VEYRA NUMBER</span><b>{profile.number}</b><button className="icon-btn" onClick={() => { navigator.clipboard?.writeText(profile.number); notify('Number copied.'); }}><Clipboard size={14}/></button></div><button className="primary-btn full" onClick={save} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16}/> : <><Check size={16}/> Save changes</>}</button></div>
  </ModalShell>;
}

function GroupInfoModal({ conversation, user, contacts, profiles, notify, onClose }: { conversation: Conversation; user: User; contacts: Contact[]; profiles: Record<string, Profile>; notify: (t: string, k?: 'error' | 'success') => void; onClose: () => void }) {
  const [name, setName] = useState(conversation.groupName || '');
  const [about, setAbout] = useState(conversation.groupAbout || '');
  const [busy, setBusy] = useState(false);
  const [groupPhoto, setGroupPhoto] = useState<File | null>(null);
  const isAdmin = (conversation.admins || []).includes(user.uid);
  const [memberUids, setMemberUids] = useState(conversation.members);
  const [admins, setAdmins] = useState(conversation.admins || []);
  useEffect(() => onSnapshot(doc(db, 'conversations', conversation.id), (snap) => { if (!snap.exists()) return; const data = snap.data(); setMemberUids(data.members || []); setAdmins(data.admins || []); setName(data.groupName || ''); setAbout(data.groupAbout || ''); }), [conversation.id]);
  const manage = async (payload: any, success: string) => { setBusy(true); try { await call('manageGroup', { conversationId: conversation.id, ...payload }); notify(success); } catch (e) { notify(explainError(e), 'error'); } finally { setBusy(false); } };
  const saveMeta = async () => {
    let groupAvatarUrl = conversation.groupAvatarUrl || '';
    if (groupPhoto) {
      try { const blob = await optimizeImage(groupPhoto, 800, 0.78); const uploaded = await uploadBytes(ref(storage, `chats/${conversation.id}/${user.uid}/group-${Date.now()}.jpg`), blob, { contentType: 'image/jpeg' }); groupAvatarUrl = await getDownloadURL(uploaded.ref); }
      catch (e) { notify(explainError(e), 'error'); return; }
    }
    await manage({ action: 'metadata', groupName: name, groupAbout: about, groupAvatarUrl }, 'Group details updated.');
  };
  const available = contacts.filter((c) => !memberUids.includes(c.uid));
  return <ModalShell title="Group details" subtitle={`${conversation.members.length} members · ${isAdmin ? 'Admin access' : 'Member view'}`} onClose={onClose}>
    <div className="group-info-modal"><div className="group-avatar-large"><label className="group-photo-edit"><input type="file" accept="image/*" disabled={!isAdmin} onChange={(e) => setGroupPhoto(e.target.files?.[0] || null)}/><Avatar name={name} src={groupPhoto ? URL.createObjectURL(groupPhoto) : conversation.groupAvatarUrl} size="xl"/>{isAdmin && <span><Camera size={13}/></span>}</label>{isAdmin && <small className="subtle-center">Tap to change group photo</small>}</div>
      <label className="field"><span>Group name</span><input disabled={!isAdmin} value={name} maxLength={24} onChange={(e) => setName(e.target.value)}/><small>{name.length}/24</small></label>
      <label className="field"><span>Group description</span><input disabled={!isAdmin} value={about} maxLength={80} onChange={(e) => setAbout(e.target.value)}/><small>{about.length}/80</small></label>
      {isAdmin && <button className="secondary-btn full" onClick={saveMeta} disabled={busy}>Save group info</button>}
      <div className="select-people-heading"><b>Members</b><span>{memberUids.length} people</span></div>
      <div className="group-members-list">{memberUids.map((uid) => <GroupMember key={uid} uid={uid} isAdmin={admins.includes(uid)} isSelf={uid === user.uid} isOwner={uid === conversation.createdBy} canManage={isAdmin} onToggleAdmin={() => manage({ action: 'toggleAdmin', targetUid: uid }, 'Admin role updated.')} onRemove={() => manage({ action: 'removeMember', targetUid: uid }, 'Member removed.')} />)}</div>
      {isAdmin && <><div className="select-people-heading"><b>Add people</b><span>From contacts</span></div><div className="group-add-list">{available.map((c) => <button key={c.uid} onClick={() => manage({ action: 'addMember', targetUid: c.uid }, `${c.shortName} added to group.`)}><Avatar name={c.shortName} src={profiles[c.uid]?.avatarUrl || c.avatarUrl}/><span>{c.shortName}</span><Plus size={16}/></button>)}{!available.length && <p className="empty-hint">All saved contacts are in this group.</p>}</div></>}
    </div>
  </ModalShell>;
}

function GroupMember({ uid, isAdmin, isSelf, isOwner, canManage, onToggleAdmin, onRemove }: { uid: string; isAdmin: boolean; isSelf: boolean; isOwner: boolean; canManage: boolean; onToggleAdmin: () => void; onRemove: () => void }) {
  const [person, setPerson] = useState<any>(null);
  useEffect(() => onSnapshot(doc(db, 'users', uid), (s) => setPerson(s.exists() ? s.data() : null)), [uid]);
  return <div className="group-member-row"><Avatar name={person?.displayName || person?.username || 'V'} src={person?.avatarUrl}/><span><b>{person?.displayName || person?.username || 'Member'}{isSelf ? ' (you)' : ''}</b><small>{isOwner ? 'Group creator' : isAdmin ? 'Admin' : 'Member'}</small></span>{canManage && !isOwner && <div className="member-actions"><button title={isAdmin ? 'Remove admin' : 'Make admin'} onClick={onToggleAdmin}>{isAdmin ? <ShieldCheck size={15}/> : <Shield size={15}/>}</button><button title="Remove member" onClick={onRemove}><X size={15}/></button></div>}</div>;
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal-card"><div className="modal-header"><div><p className="eyebrow">VEYRA / SPACE</p><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-btn close-btn" onClick={onClose}><X size={19}/></button></div><div className="modal-body">{children}</div></section></div>;
}

function ChatView({ conversation, user, profile, title, avatar, contacts, profiles, notify, initialDraft, onInitialDraftConsumed, onBack, onGroupInfo }: { conversation: Conversation; user: User; profile: Profile; title: string; avatar?: string; contacts: Contact[]; profiles: Record<string, Profile>; notify: (t: string, k?: 'error' | 'success') => void; initialDraft: string; onInitialDraftConsumed: () => void; onBack: () => void; onGroupInfo: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const typingTimerRef = useRef<number | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [undoMessageId, setUndoMessageId] = useState<string | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const [fileMode, setFileMode] = useState<'image' | 'video' | 'file' | 'sticker'>('image');
  const otherUid = conversation.members.find((id) => id !== user.uid) || '';
  const other = profiles[otherUid];
  const displayContact = contacts.find((c) => c.uid === otherUid);
  const typingLabel = Object.entries(typing).filter(([id, updatedAt]) => id !== user.uid && Date.now() - updatedAt < 6000).map(([id]) => id === otherUid ? (displayContact?.shortName || other?.displayName || 'Someone') : 'Someone').join(', ');

  useEffect(() => {
    const q = query(collection(db, 'conversations', conversation.id, 'messages'), orderBy('createdAt', 'asc'), limit(100));
    return onSnapshot(q, async (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
      setMessages(next);
      const unread = next.filter((m) => m.senderId !== user.uid && !(m.readBy || []).includes(user.uid) && !m.deletedForEveryone);
      for (const msg of unread.slice(-30)) {
        updateDoc(doc(db, 'conversations', conversation.id, 'messages', msg.id), { readBy: arrayUnion(user.uid), deliveredTo: arrayUnion(user.uid) }).catch(() => {});
      }
      const bottom = scrollRef.current;
      if (bottom) window.setTimeout(() => bottom.scrollTo({ top: bottom.scrollHeight, behavior: 'smooth' }), 60);
    }, (error) => notify(explainError(error), 'error'));
  }, [conversation.id, user.uid, notify]);

  useEffect(() => onSnapshot(collection(db, 'users', user.uid, 'hiddenMessages'), (snap) => setHidden(snap.docs.filter((d) => d.get('conversationId') === conversation.id).map((d) => d.id))), [conversation.id, user.uid]);
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'conversations', conversation.id, 'typing'), (snap) => {
      const next = Object.fromEntries(snap.docs.filter((d) => d.get('isTyping')).map((d) => [d.id, d.get('updatedAt')?.toMillis?.() || 0]));
      setTyping(next);
    }, (error) => notify(explainError(error), 'error'));
    const expiryTimer = window.setInterval(() => {
      setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, updatedAt]) => Date.now() - updatedAt < 6000)));
    }, 1000);
    return () => { unsubscribe(); window.clearInterval(expiryTimer); };
  }, [conversation.id, user.uid, notify]);

  useEffect(() => { setDraft(''); setMenuId(null); }, [conversation.id]);
  useEffect(() => { if (initialDraft) { setDraft(initialDraft); onInitialDraftConsumed(); window.setTimeout(() => inputRef.current?.focus(), 80); } }, [initialDraft, onInitialDraftConsumed]);
  useEffect(() => () => { if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current); }, []);
  const visibleMessages = messages.filter((m) => !hidden.includes(m.id));

  const updateTyping = (value: string) => {
    setDraft(value);
    const typingRef = doc(db, 'conversations', conversation.id, 'typing', user.uid);
    if (value.trim()) setDoc(typingRef, { isTyping: true, updatedAt: serverTimestamp() }).catch(() => {});
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => setDoc(typingRef, { isTyping: false, updatedAt: serverTimestamp() }).catch(() => {}), 1400);
  };

  const send = async (text = draft, type = 'text', media?: { url: string; name: string; size: number; path: string }) => {
    if (!text.trim() && !media) return;
    setSending(true);
    try {
      const payload: any = {
        senderId: user.uid, type, text: text.trim().slice(0, 4000),
        createdAt: serverTimestamp(), editedAt: null, deletedForEveryone: false,
        readBy: [user.uid], deliveredTo: [user.uid], reactions: {}
      };
      if (media) { payload.mediaUrl = media.url; payload.mediaName = media.name; payload.mediaSize = media.size; payload.storagePath = media.path; }
      await addDoc(collection(db, 'conversations', conversation.id, 'messages'), payload);
      await updateDoc(doc(db, 'conversations', conversation.id), { updatedAt: serverTimestamp(), lastMessage: { text: payload.text || `${type} message`, type, senderId: user.uid, createdAt: serverTimestamp() } });
      setDraft('');
      setDoc(doc(db, 'conversations', conversation.id, 'typing', user.uid), { isTyping: false, updatedAt: serverTimestamp() }).catch(() => {});
      inputRef.current?.focus();
    } catch (error) { notify(explainError(error), 'error'); }
    finally { setSending(false); }
  };

  const pickFile = (mode: 'image' | 'video' | 'file' | 'sticker') => { setFileMode(mode); setAttachOpen(false); mediaRef.current?.click(); };
  const uploadFile = async (file: File) => {
    const isVideo = file.type.startsWith('video/');
    if (isVideo && file.size > 80 * 1024 * 1024) return notify('Video sumber maksimal 80 MB agar tidak membebani perangkat.', 'error');
    if (!isVideo && file.size > 20 * 1024 * 1024) return notify('File maksimal 20 MB.', 'error');
    let blob: Blob = file;
    let type: ChatMessage['type'] = fileMode;
    if (file.type.startsWith('image/')) {
      if (fileMode !== 'sticker') { blob = await optimizeImage(file, 1600, 0.78); type = 'image'; }
      else type = 'sticker';
    } else if (isVideo) {
      setSending(true);
      try { blob = await compressVideo(file); }
      catch (error) { setSending(false); return notify(explainError(error), 'error'); }
      if (blob.size > 35 * 1024 * 1024) { setSending(false); return notify('Hasil kompresi masih di atas 35 MB. Potong durasi video lalu coba lagi.', 'error'); }
      type = 'video';
    } else if (file.type.startsWith('audio/')) type = 'audio';
    else type = 'file';
    const ext = type === 'image' || type === 'sticker' ? 'jpg' : type === 'video' ? 'webm' : file.name.split('.').pop() || 'bin';
    const path = `chats/${conversation.id}/${user.uid}/${Date.now()}-${idOf()}.${ext}`;
    setSending(true);
    try {
      const upload = uploadBytesResumable(ref(storage, path), blob, { contentType: blob.type || file.type || 'application/octet-stream' });
      await new Promise<void>((resolve, reject) => upload.on('state_changed', undefined, reject, () => resolve()));
      const url = await getDownloadURL(upload.snapshot.ref);
      await send('', type, { url, name: file.name, size: blob.size, path });
    } catch (e) { notify(explainError(e), 'error'); }
    finally { setSending(false); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());
        if (blob.size > 15 * 1024 * 1024) { notify('Voice note terlalu besar.', 'error'); return; }
        const path = `chats/${conversation.id}/${user.uid}/${Date.now()}-voice.webm`;
        try { const uploaded = await uploadBytes(ref(storage, path), blob, { contentType: blob.type }); const url = await getDownloadURL(uploaded.ref); await send('', 'audio', { url, name: 'Voice message', size: blob.size, path }); }
        catch (e) { notify(explainError(e), 'error'); }
      };
      recorder.start(); mediaRecorderRef.current = recorder; setRecording(true);
    } catch { notify('Izinkan akses mikrofon untuk merekam voice note.', 'error'); }
  };
  const stopRecording = () => { mediaRecorderRef.current?.stop(); setRecording(false); };

  const react = async (message: ChatMessage, emoji: string) => {
    try { await call('reactToMessage', { conversationId: conversation.id, messageId: message.id, emoji }); setMenuId(null); }
    catch (e) { notify(explainError(e), 'error'); }
  };
  const edit = async (message: ChatMessage) => {
    const next = window.prompt('Edit message', message.text || '');
    if (next === null || !next.trim()) return;
    try { await call('editMessage', { conversationId: conversation.id, messageId: message.id, text: next }); notify('Message edited.'); }
    catch (e) { notify(explainError(e), 'error'); }
  };
  const deleteMessage = async (message: ChatMessage, everyone: boolean) => {
    if (everyone && !window.confirm('Hapus pesan ini untuk semua orang?')) return;
    try {
      await call(everyone ? 'deleteMessageForEveryone' : 'deleteMessageForSelf', { conversationId: conversation.id, messageId: message.id });
      if (everyone) notify('Message deleted for everyone.');
      else {
        setUndoMessageId(message.id);
        if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = window.setTimeout(() => setUndoMessageId(null), 5000);
      }
      setMenuId(null);
    } catch (e) { notify(explainError(e), 'error'); }
  };
  const block = async () => {
    if (!otherUid || !window.confirm(`Block ${title}? Kamu berdua tidak bisa saling mengirim pesan.`)) return;
    try { await call('setBlock', { targetUid: otherUid, blocked: true }); notify('Contact blocked.'); }
    catch (e) { notify(explainError(e), 'error'); }
  };
  const handleLongPress = (message: ChatMessage) => setMenuId((old) => old === message.id ? null : message.id);

  return <div className="chat-view">
    <header className="chat-header"><button className="back-mobile icon-btn" onClick={onBack}><ArrowLeft size={19}/></button><Avatar name={title} src={avatar} size="md" online={conversation.type === 'direct' && !!other?.online}/><button className="chat-header-title" onClick={conversation.type === 'group' ? onGroupInfo : undefined}><b>{title}</b><small>{conversation.type === 'group' ? `${conversation.members.length} members` : other?.online ? 'online' : other?.lastSeen?.toDate ? `last seen ${formatTime(other.lastSeen)}` : 'private conversation'}</small></button><div className="chat-header-actions">{conversation.type === 'direct' && <><button className="icon-btn call-soon" disabled title="Voice call · Coming soon"><Phone size={17}/></button><button className="icon-btn call-soon" disabled title="Video call · Coming soon"><Video size={17}/></button><button className="icon-btn" onClick={block} title="Block contact"><Ban size={17}/></button></>}{conversation.type === 'group' && <button className="icon-btn" onClick={onGroupInfo}><Info size={18}/></button>}</div></header>
    <div className="message-scroll" ref={scrollRef} onClick={() => setMenuId(null)}><div className="conversation-date">YOUR CONVERSATION</div>
      {visibleMessages.map((message) => <MessageBubble key={message.id} message={message} mine={message.senderId === user.uid} allRead={(message.readBy || []).filter((id) => id !== message.senderId).length >= conversation.members.filter((id) => id !== message.senderId).length} senderName={message.senderId === user.uid ? profile.displayName : conversation.type === 'group' ? profiles[message.senderId]?.displayName || 'Member' : title} otherUid={otherUid} onLongPress={() => handleLongPress(message)} menuOpen={menuId === message.id} onCloseMenu={() => setMenuId(null)} onEdit={() => edit(message)} onDeleteSelf={() => deleteMessage(message, false)} onDeleteAll={() => deleteMessage(message, true)} onReact={(emoji) => react(message, emoji)} />)}
      {!visibleMessages.length && <div className="first-message"><div className="first-message-icon"><Sparkles size={20}/></div><b>This is the beginning.</b><p>A new conversation starts with a simple hello.</p></div>}
      {typingLabel && <div className="typing-indicator"><span className="typing-dots"><i/><i/><i/></span><small>{typingLabel} is typing</small></div>}
    </div>
    <div className="composer-area">
      {undoMessageId && <div className="undo-toast"><span>Message deleted from your chat.</span><button onClick={async () => { try { await deleteDoc(doc(db, 'users', user.uid, 'hiddenMessages', undoMessageId)); setUndoMessageId(null); if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current); notify('Message restored.'); } catch (e) { notify(explainError(e), 'error'); } }}>Urungkan</button></div>}
      <div className="composer"><button className="icon-btn attach-btn" onClick={() => setAttachOpen(!attachOpen)} title="Attach"><Paperclip size={19}/></button><textarea ref={inputRef} rows={1} value={draft} onChange={(e) => { updateTyping(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 110)}px`; }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Write a message"/>{recording ? <button className="send-btn recording" onClick={stopRecording}><span/> Stop</button> : draft.trim() ? <button className="send-btn" onClick={() => send()} disabled={sending}><Send size={17}/></button> : <button className="send-btn voice" onClick={startRecording} title="Record voice note"><Mic size={18}/></button>}</div>
      {attachOpen && <div className="attach-menu"><button onClick={() => pickFile('image')}><Image size={17}/> Photo</button><button onClick={() => pickFile('video')}><Video size={17}/> Video</button><button onClick={() => pickFile('file')}><FilePlus2 size={17}/> File</button><button onClick={() => pickFile('sticker')}><Sticker size={17}/> Sticker</button></div>}
      <input ref={mediaRef} type="file" hidden accept={fileMode === 'image' || fileMode === 'sticker' ? 'image/*' : fileMode === 'video' ? 'video/*' : '*/*'} onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadFile(file); e.target.value = ''; }}/>
      <p className="composer-foot">Messages sync in real time <span>·</span> Voice notes are supported <span>·</span> Calls coming soon</p>
    </div>
  </div>;
}

function MessageBubble({ message, mine, allRead, senderName, otherUid, onLongPress, menuOpen, onCloseMenu, onEdit, onDeleteSelf, onDeleteAll, onReact }: { message: ChatMessage; mine: boolean; allRead: boolean; senderName: string; otherUid: string; onLongPress: () => void; menuOpen: boolean; onCloseMenu: () => void; onEdit: () => void; onDeleteSelf: () => void; onDeleteAll: () => void; onReact: (e: string) => void }) {
  const timer = useRef<number | null>(null);
  const onTouchStart = () => { timer.current = window.setTimeout(onLongPress, 520); };
  const onTouchEnd = () => { if (timer.current) window.clearTimeout(timer.current); };
  const deleted = message.deletedForEveryone;
  const reacted = Object.values(message.reactions || {}).reduce<Record<string, number>>((acc, emoji) => { acc[emoji] = (acc[emoji] || 0) + 1; return acc; }, {});
  return <div className={`message-line ${mine ? 'mine' : 'theirs'}`} onContextMenu={(e) => { e.preventDefault(); onLongPress(); }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
    <div className={`message-bubble ${mine ? 'outgoing' : 'incoming'} ${deleted ? 'deleted' : ''}`}>
      {!mine && <small className="message-sender">{senderName}</small>}
      {deleted ? <div className="deleted-label"><Ban size={13}/> This message has been deleted</div> : <>
        {message.type === 'image' && message.mediaUrl && <img className="message-image" src={message.mediaUrl} alt={message.mediaName || 'Shared image'} onClick={() => window.open(message.mediaUrl, '_blank')}/>}
        {message.type === 'video' && message.mediaUrl && <video className="message-video" src={message.mediaUrl} controls playsInline/>}
        {message.type === 'audio' && message.mediaUrl && <div className="audio-message"><AudioLines size={20}/><audio controls src={message.mediaUrl}/></div>}
        {message.type === 'sticker' && message.mediaUrl && <img className="message-sticker" src={message.mediaUrl} alt="Sticker"/>}
        {message.type === 'file' && message.mediaUrl && <a className="file-message" href={message.mediaUrl} target="_blank" rel="noreferrer"><File size={20}/><span>{message.mediaName || 'Attachment'}<small>{formatBytes(message.mediaSize)}</small></span><ArrowUpRight size={15}/></a>}
        {message.text && <p className="message-text">{message.text}</p>}
        {message.editedAt && <small className="edited-label">Edited</small>}
      </>}
      <div className="message-meta"><time>{formatTime(message.createdAt)}</time>{mine && !deleted && <span className={`read-ticks ${allRead ? 'read' : ''}`} title={allRead ? 'Read' : 'Delivered'}><CheckCheck size={15}/></span>}</div>
      {Object.keys(reacted).length > 0 && <div className="message-reactions">{Object.entries(reacted).map(([emoji, count]) => <span key={emoji}>{emoji} {count}</span>)}</div>}
      {menuOpen && <div className={`message-context ${mine ? 'context-mine' : ''}`} onClick={(e) => e.stopPropagation()}><div className="reaction-strip">{['❤️', '👍', '😂', '😮', '😢', '🙏'].map((e) => <button key={e} onClick={() => onReact(e)}>{e}</button>)}</div>{mine && !deleted && <button onClick={onEdit}><Pencil size={14}/> Edit message</button>}<button onClick={onDeleteSelf}><Trash2 size={14}/> Delete for me</button>{mine && !deleted && <button className="danger-action" onClick={onDeleteAll}><Trash2 size={14}/> Delete for everyone</button>}</div>}
    </div>
  </div>;
}

async function compressVideo(file: File): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
    throw new Error('Video compression is not supported on this device.');
  }
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto'; video.playsInline = true; video.src = sourceUrl;
  const waitFor = (eventName: string) => new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not read this video file.')); };
    const cleanup = () => { video.removeEventListener(eventName, done); video.removeEventListener('error', fail); };
    video.addEventListener(eventName, done, { once: true }); video.addEventListener('error', fail, { once: true });
  });
  try {
    await waitFor('loadedmetadata');
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Video compression could not initialize.');
    const stream = canvas.captureStream(24);
    const sourceVideo = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
    const sourceStream = sourceVideo.captureStream?.() || sourceVideo.mozCaptureStream?.();
    sourceStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mime) throw new Error('This device cannot encode a compressed video format.');
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_400_000, audioBitsPerSecond: 96_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    let drawing = true;
    const drawFrame = () => {
      if (!drawing) return;
      if (video.readyState >= 2) context.drawImage(video, 0, 0, canvas.width, canvas.height);
      requestAnimationFrame(drawFrame);
    };
    const ended = new Promise<void>((resolve, reject) => {
      video.addEventListener('ended', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('Video playback failed during compression.')), { once: true });
    });
    recorder.start(1000);
    drawFrame();
    await video.play();
    await ended;
    drawing = false;
    const result = new Promise<Blob>((resolve) => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunks, { type: mime })), { once: true });
    });
    recorder.stop();
    const output = await result;
    stream.getTracks().forEach((track) => track.stop());
    sourceStream?.getTracks().forEach((track) => track.stop());
    return output;
  } finally {
    video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(sourceUrl);
  }
}

async function optimizeImage(file: File, maxDimension = 1600, quality = 0.8): Promise<Blob> {
  const image = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Image processing is unavailable.');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not compress image.')), 'image/jpeg', quality));
}

function ContactsView({ contacts, profiles, onAdd, onChat, onGroup }: { contacts: Contact[]; profiles: Record<string, Profile>; onAdd: () => void; onChat: (c: Contact) => void; onGroup: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = contacts.filter((c) => `${c.shortName} ${c.fullName} ${c.number}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="section-page"><div className="pane-header"><div><p className="eyebrow">YOUR PEOPLE</p><h1>Contacts <span className="count-pill">{contacts.length}</span></h1></div><div className="header-actions"><button className="round-btn" onClick={onGroup}><Users size={17}/></button><button className="round-btn active" onClick={onAdd}><Plus size={19}/></button></div></div><div className="search-box"><Search size={16}/><input placeholder="Search contacts" value={search} onChange={(e) => setSearch(e.target.value)}/></div><div className="contacts-section-title">ALL CONTACTS <span>{filtered.length}</span></div><div className="contacts-grid">{filtered.map((c) => <button className="contact-card" key={c.uid} onClick={() => onChat(c)}><Avatar name={c.shortName} src={profiles[c.uid]?.avatarUrl || c.avatarUrl} size="lg"/><span><b>{c.shortName}</b><small>{c.fullName}</small><small>{c.number}</small></span><ArrowUpRight size={16}/></button>)}{!filtered.length && <EmptyState icon={<Users size={23}/>} title="No contacts yet" text="Add a Veyra number to get started." action={<button className="text-action" onClick={onAdd}>Add contact <ArrowUpRight size={14}/></button>}/>}</div></div>;
}

function SettingsView({ profile, user, blockedUsers, notify, onProfile, onLogout, onUnblock, profiles }: { profile: Profile; user: User; blockedUsers: string[]; notify: (t: string, k?: 'error' | 'success') => void; onProfile: () => void; onLogout: () => void; onUnblock: (uid: string) => void; profiles: Record<string, Profile> }) {
  return <div className="section-page settings-page"><div className="pane-header"><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1></div></div><div className="settings-profile-card"><Avatar name={profile.displayName} src={profile.avatarUrl} size="xl"/><div><b>{profile.displayName}</b><small>@{profile.username}</small><small>Veyra ID · {profile.number}</small></div><button className="secondary-btn" onClick={onProfile}><Pencil size={14}/> Edit profile</button></div><div className="settings-block"><div className="settings-block-head"><div><b>Account</b><small>Personal information and access</small></div><CircleUserRound size={19}/></div><div className="settings-line"><span><b>Username</b><small>@{profile.username}</small></span><span className="setting-value">Unique handle</span></div><div className="settings-line"><span><b>Veyra number</b><small>{profile.number}</small></span><button className="icon-btn" onClick={() => { navigator.clipboard?.writeText(profile.number); notify('Number copied.'); }}><Clipboard size={15}/></button></div><div className="settings-line"><span><b>Account security</b><small>Password protected by Firebase Authentication</small></span><ShieldCheck size={18}/></div></div><div className="settings-block"><div className="settings-block-head"><div><b>Privacy & safety</b><small>Manage who can reach you</small></div><Shield size={19}/></div><div className="settings-line"><span><b>Blocked contacts</b><small>{blockedUsers.length} accounts blocked</small></span><Ban size={18}/></div>{blockedUsers.map((uid) => <BlockedPerson key={uid} uid={uid} onUnblock={() => onUnblock(uid)}/>)}</div><div className="settings-block"><div className="settings-block-head"><div><b>Notifications</b><small>Device notifications and message alerts</small></div><Bell size={19}/></div><div className="settings-line"><span><b>Push notifications</b><small>Enabled on Android after permission is granted</small></span><span className="setting-status"><i/> Native</span></div><div className="settings-line"><span><b>Typing indicators</b><small>Show when contacts are writing</small></span><span className="setting-status"><i/> Active</span></div></div><div className="settings-block"><div className="settings-block-head"><div><b>About Veyra</b><small>Version 1.0.0 · Calls coming soon</small></div><Info size={19}/></div><p className="settings-disclaimer">Veyra is an independent messaging app and is not affiliated with WhatsApp. Voice/video calling and end-to-end encryption are not available in this starter release.</p></div><button className="logout-btn" onClick={onLogout}><LogOut size={17}/> Log out</button></div>;
}
function BlockedPerson({ uid, onUnblock }: { uid: string; onUnblock: () => void }) {
  const [person, setPerson] = useState<any>(null);
  useEffect(() => onSnapshot(doc(db, 'users', uid), (s) => setPerson(s.exists() ? s.data() : null)), [uid]);
  return <div className="blocked-person"><Avatar name={person?.displayName || person?.username || 'V'} src={person?.avatarUrl}/><span>{person?.displayName || 'Blocked account'}</span><button className="text-action" onClick={onUnblock}>Unblock</button></div>;
}

function UpdatesView({ user, profile, contacts, profiles, notify, onNew, onReply }: { user: User; profile: Profile; contacts: Contact[]; profiles: Record<string, Profile>; notify: (t: string, k?: 'error' | 'success') => void; onNew: () => void; onReply: (c: Contact, status: any) => void }) {
  const [statuses, setStatuses] = useState<any[]>([]);
  const [viewing, setViewing] = useState<any>(null);
  useEffect(() => {
    const owners = [user.uid, ...contacts.map((c) => c.uid)];
    const chunks: string[][] = [];
    for (let i = 0; i < owners.length; i += 30) chunks.push(owners.slice(i, i + 30));
    const snapshots = new Map<string, any>();
    const unsubs = chunks.map((group) => {
      const q = query(collection(db, 'statuses'), where('uid', 'in', group), orderBy('createdAt', 'desc'), limit(100));
      return onSnapshot(q, (snap) => {
        snap.docs.forEach((d) => snapshots.set(d.id, { id: d.id, ...d.data() }));
        const fresh = [...snapshots.values()].filter((s: any) => s.expiresAt?.toMillis?.() > Date.now()).sort((a: any, b: any) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setStatuses(fresh);
      }, (e) => notify(explainError(e), 'error'));
    });
    return () => unsubs.forEach((off) => off());
  }, [user.uid, contacts, notify]);
  const visible = statuses;
  const mine = visible.filter((s) => s.uid === user.uid);
  const latestByUid = new Map<string, any>(); visible.forEach((s) => { if (!latestByUid.has(s.uid)) latestByUid.set(s.uid, s); });
  return <div className="section-page updates-page"><div className="pane-header"><div><p className="eyebrow">LITTLE MOMENTS</p><h1>Updates</h1></div><button className="round-btn active" onClick={onNew}><Plus size={19}/></button></div><div className="updates-card"><div className="updates-title"><div><b>My status</b><small>Share a moment with your contacts</small></div><button className="text-action" onClick={onNew}>Add status <ArrowUpRight size={14}/></button></div><button className="my-status-row" onClick={onNew}><div className="status-avatar-wrap"><Avatar name={profile.displayName} src={profile.avatarUrl} size="lg"/><i><Plus size={12}/></i></div><span><b>My status</b><small>{mine.length ? 'Tap to add another update' : 'Share a photo or a thought'}</small></span></button></div><div className="updates-card"><div className="updates-title"><div><b>Recent updates</b><small>Disappears after 24 hours</small></div><span className="count-pill">{Math.max(0, latestByUid.size - (mine.length ? 1 : 0))}</span></div>{[...latestByUid.entries()].filter(([uid]) => uid !== user.uid).map(([uid, status]) => { const c = contacts.find((x) => x.uid === uid); return <button className="status-row" key={uid} onClick={() => setViewing(status)}><span className="status-ring"><Avatar name={c?.shortName || status.displayName || 'V'} src={profiles[uid]?.avatarUrl || status.avatarUrl || c?.avatarUrl} size="md"/></span><span><b>{c?.shortName || c?.fullName || status.displayName || 'Contact'}</b><small>{status.createdAt?.toDate ? formatTime(status.createdAt) : 'Recently'}</small></span><ChevronRight size={16}/></button>; })}{!visible.some((s) => s.uid !== user.uid) && <p className="empty-hint">No updates from your contacts yet.</p>}</div>{viewing && <div className="status-viewer" onClick={() => setViewing(null)}><div className="status-viewer-card" onClick={(e) => e.stopPropagation()}><button className="icon-btn close-btn" onClick={() => setViewing(null)}><X size={19}/></button>{viewing.mediaUrl ? viewing.type === 'video' ? <video src={viewing.mediaUrl} controls autoPlay/> : <img src={viewing.mediaUrl} alt="Status"/> : <p>{viewing.text}</p>}<div className="status-viewer-footer"><span>{contacts.find((c) => c.uid === viewing.uid)?.shortName || profiles[viewing.uid]?.displayName || 'Contact'}</span><button className="primary-btn" onClick={() => { const contact = contacts.find((c) => c.uid === viewing.uid); if (contact) { onReply(contact, viewing); setViewing(null); } }}><Reply size={15}/> Reply</button></div></div></div>}</div>;
}

function CreateStatusModal({ user, notify, onClose }: { user: User; notify: (t: string, k?: 'error' | 'success') => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!text.trim() && !file) return;
    setBusy(true);
    try {
      let mediaUrl = ''; let type = 'text';
      let storagePath = '';
      if (file) {
        const isVideo = file.type.startsWith('video/');
        if (file.size > (isVideo ? 80 : 20) * 1024 * 1024) throw new Error(isVideo ? 'Video sumber maksimal 80 MB.' : 'Foto maksimal 20 MB.');
        const blob = isVideo ? await compressVideo(file) : await optimizeImage(file, 1400, 0.78);
        if (blob.size > 20 * 1024 * 1024) throw new Error('Hasil media masih di atas 20 MB. Potong durasi video atau pilih file lain.');
        type = isVideo ? 'video' : 'image';
        const extension = isVideo ? 'webm' : 'jpg';
        storagePath = `statuses/${user.uid}/${Date.now()}.${extension}`;
        const uploaded = await uploadBytes(ref(storage, storagePath), blob, { contentType: blob.type || file.type });
        mediaUrl = await getDownloadURL(uploaded.ref);
      }
      await addDoc(collection(db, 'statuses'), { uid: user.uid, text: text.trim().slice(0, 500), type, mediaUrl, storagePath, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) });
      notify('Status shared with your contacts.'); onClose();
    } catch (e) { notify(explainError(e), 'error'); }
    finally { setBusy(false); }
  };
  return <ModalShell title="Create status" subtitle="A small moment, shared for 24 hours." onClose={onClose}><div className="modal-form"><textarea className="status-textarea" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="What's happening?"/><small className="character-count">{text.length}/500</small><label className="status-file"><input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] || null)}/><ImagePlus size={19}/><span>{file ? file.name : 'Add a photo or short video'}</span></label><button className="primary-btn full" disabled={busy || (!text.trim() && !file)} onClick={create}>{busy ? <LoaderCircle className="spin" size={16}/> : <><Send size={16}/> Share status</>}</button></div></ModalShell>;
}

export default App;
