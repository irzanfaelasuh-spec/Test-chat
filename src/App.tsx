import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import {
  getDownloadURL,
  ref,
  uploadBytes
} from 'firebase/storage';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  Image,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings,
  Users,
  X
} from 'lucide-react';

import { auth, db, firebaseReady, storage } from './firebase';

type Profile = {
  uid: string;
  username: string;
  displayName: string;
  number: string;
  avatarUrl?: string;
  about?: string;
  online?: boolean;
};

type Chat = {
  id: string;
  type: 'direct' | 'group';
  members: string[];
  groupName?: string;
  lastMessage?: string;
  updatedAt?: any;
};

type Message = {
  id: string;
  senderId: string;
  text?: string;
  mediaUrl?: string;
  type: string;
  createdAt?: any;
};

const usernameEmail = (name: string) =>
  `${name.trim().toLowerCase()}@account.veyra.chat`;

const makeNumber = () =>
  Math.floor(1000000000 + Math.random() * 9000000000).toString();

const getInitials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'V';

const time = (value: any) => {
  if (!value?.toDate) return '';
  return value.toDate().toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit'
  });
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  const [contacts, setContacts] = useState<Profile[]>([]);
  const [tab, setTab] = useState<'chats' | 'contacts' | 'settings'>('chats');

  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [addNumber, setAddNumber] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const notify = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(''), 3000);
  };

  useEffect(() => {
    return onAuthStateChanged(auth, async current => {
      setUser(current);
      setProfile(null);

      if (!current) {
        setChats([]);
        setContacts([]);
        setActiveChat(null);
        setLoading(false);
        return;
      }

      try {
        const snapshot = await getDoc(doc(db, 'users', current.uid));

        if (snapshot.exists()) {
          setProfile({
            uid: current.uid,
            ...snapshot.data()
          } as Profile);
        }
      } catch (error: any) {
        notify(error.message || 'Could not load profile.');
      }

      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    const chatsQuery = query(
      collection(db, 'conversations'),
      where('members', 'array-contains', user.uid),
      orderBy('updatedAt', 'desc'),
      limit(100)
    );

    return onSnapshot(chatsQuery, snapshot => {
      setChats(snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as Chat)));
    }, error => notify(error.message));
  }, [user]);

  useEffect(() => {
    if (!user) return;

    return onSnapshot(
      collection(db, 'users', user.uid, 'contacts'),
      snapshot => {
        setContacts(snapshot.docs.map(d => ({
          uid: d.id,
          ...d.data()
        } as Profile)));
      }
    );
  }, [user]);

  useEffect(() => {
    if (!user || !activeChat) {
      setMessages([]);
      return;
    }

    const messagesQuery = query(
      collection(db, 'conversations', activeChat.id, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200)
    );

    return onSnapshot(messagesQuery, snapshot => {
      setMessages(snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      } as Message)));

      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }, error => notify(error.message));
  }, [user, activeChat?.id]);

  useEffect(() => {
    if (!user) return;

    const ids = [...new Set(
      chats.flatMap(chat => chat.members.filter(id => id !== user.uid))
    )];

    const unsubscribers = ids.map(uid =>
      onSnapshot(doc(db, 'users', uid), snapshot => {
        if (snapshot.exists()) {
          setProfiles(old => ({
            ...old,
            [uid]: { uid, ...snapshot.data() } as Profile
          }));
        }
      })
    );

    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [user, chats]);

  const filteredChats = useMemo(() => {
    return chats.filter(chat => {
      const other = chat.members.find(id => id !== user?.uid);
      const name = chat.type === 'group'
        ? chat.groupName
        : profiles[other || '']?.displayName;

      return (name || '').toLowerCase().includes(search.toLowerCase());
    });
  }, [chats, search, profiles, user]);

  const register = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const name = username.trim().toLowerCase();

    if (!/^[a-z0-9_.]{3,20}$/.test(name)) {
      notify('Username harus 3–20 karakter.');
      return;
    }

    if (password.length < 8) {
      notify('Password minimal 8 karakter.');
      return;
    }

    setBusy(true);

    try {
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(
          auth,
          usernameEmail(name),
          password
        );

        const number = makeNumber();

        const newProfile: Profile = {
          uid: credential.user.uid,
          username: name,
          displayName: displayName.trim() || name,
          number,
          about: 'Available',
          online: true
        };

        await setDoc(doc(db, 'users', credential.user.uid), {
          ...newProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        await setDoc(doc(db, 'numbers', number), {
          uid: credential.user.uid
        });

        await setDoc(doc(db, 'usernames', name), {
          uid: credential.user.uid
        });

        setProfile(newProfile);
      } else {
        await signInWithEmailAndPassword(
          auth,
          usernameEmail(name),
          password
        );
      }
    } catch (error: any) {
      notify(error.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const openChat = async (target: Profile) => {
    if (!user) return;

    try {
      const members = [user.uid, target.uid].sort();
      const chatId = `d_${members[0]}_${members[1]}`;

      const chatRef = doc(db, 'conversations', chatId);
      const snapshot = await getDoc(chatRef);

      if (!snapshot.exists()) {
        await setDoc(chatRef, {
          type: 'direct',
          members,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastMessage: ''
        });
      }

      setActiveChat({
        id: chatId,
        type: 'direct',
        members
      });

      setTab('chats');
    } catch (error: any) {
      notify(error.message);
    }
  };

  const addContact = async () => {
    if (!user || !addNumber.trim()) return;

    setBusy(true);

    try {
      const numberRef = await getDoc(
        doc(db, 'numbers', addNumber.trim())
      );

      if (!numberRef.exists()) {
        throw new Error('Veyra number tidak ditemukan.');
      }

      const targetUid = numberRef.data().uid;

      if (targetUid === user.uid) {
        throw new Error('Tidak bisa menambahkan akun sendiri.');
      }

      const target = await getDoc(doc(db, 'users', targetUid));

      if (!target.exists()) {
        throw new Error('Profile tidak ditemukan.');
      }

      const data = target.data() as Profile;

      await setDoc(
        doc(db, 'users', user.uid, 'contacts', targetUid),
        {
          uid: targetUid,
          username: data.username,
          displayName: data.displayName,
          number: data.number,
          shortName: data.displayName,
          fullName: data.displayName,
          avatarUrl: data.avatarUrl || '',
          createdAt: serverTimestamp()
        }
      );

      setAddNumber('');
      notify('Contact berhasil ditambahkan.');
    } catch (error: any) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();

    if (!user || !activeChat || !message.trim()) return;

    const text = message.trim();
    setMessage('');

    try {
      await addDoc(
        collection(db, 'conversations', activeChat.id, 'messages'),
        {
          senderId: user.uid,
          text,
          type: 'text',
          createdAt: serverTimestamp()
        }
      );

      await updateDoc(doc(db, 'conversations', activeChat.id), {
        lastMessage: text,
        updatedAt: serverTimestamp()
      });
    } catch (error: any) {
      setMessage(text);
      notify(error.message);
    }
  };

  const sendImage = async (file?: File) => {
    if (!user || !activeChat || !file) return;

    if (file.size > 10 * 1024 * 1024) {
      notify('Ukuran gambar maksimal 10 MB.');
      return;
    }

    setBusy(true);

    try {
      const path = `messages/${activeChat.id}/${Date.now()}_${file.name}`;
      const uploaded = await uploadBytes(ref(storage, path), file);
      const url = await getDownloadURL(uploaded.ref);

      await addDoc(
        collection(db, 'conversations', activeChat.id, 'messages'),
        {
          senderId: user.uid,
          type: 'image',
          mediaUrl: url,
          mediaName: file.name,
          createdAt: serverTimestamp()
        }
      );

      await updateDoc(doc(db, 'conversations', activeChat.id), {
        lastMessage: 'Photo',
        updatedAt: serverTimestamp()
      });
    } catch (error: any) {
      notify(error.message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setProfile(null);
    setActiveChat(null);
  };

  if (!firebaseReady) {
    return (
      <div className="screen">
        <h1>Veyra</h1>
        <p>Firebase configuration is missing.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="screen"><div className="loader" /><p>Loading Veyra...</p></div>;
  }

  if (!user || !profile) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand">veyra<span>.</span></div>
          <p className="eyebrow">YOUR SPACE TO CONNECT</p>
          <h1>{mode === 'login' ? 'Welcome back.' : 'Create your space.'}</h1>
          <p className="muted">A quieter place for the people who matter.</p>

          <form onSubmit={register}>
            {mode === 'signup' && (
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </label>
            )}

            <label>
              Username
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Your username"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
            </label>

            <button className="primary" disabled={busy}>
              {busy ? 'Please wait...' : mode === 'login' ? 'Enter Veyra' : 'Create account'}
              <ArrowUpRight size={17} />
            </button>
          </form>

          <button className="switch" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Create an account' : 'Already have an account? Login'}
          </button>
        </div>

        {notice && <div className="toast">{notice}</div>}

        <style>{styles}</style>
      </div>
    );
  }

  const otherUid = activeChat?.members.find(id => id !== user.uid);
  const otherProfile = profiles[otherUid || ''];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">veyra<span>.</span></div>

        <div className="nav">
          <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}>
            <MessageCircle size={19} /> Chats
          </button>
          <button className={tab === 'contacts' ? 'active' : ''} onClick={() => setTab('contacts')}>
            <Users size={19} /> Contacts
          </button>
          <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
            <Settings size={19} /> Settings
          </button>
        </div>

        <button className="profile-mini" onClick={() => setTab('settings')}>
          <div className="avatar">{getInitials(profile.displayName)}</div>
          <span>{profile.displayName}<small>@{profile.username}</small></span>
        </button>
      </aside>

      <main className="main">
        {tab === 'chats' && (
          <section className={`chat-list ${activeChat ? 'hide-mobile' : ''}`}>
            <header>
              <div>
                <p className="eyebrow">YOUR MESSAGES</p>
                <h1>Chats</h1>
              </div>
              <button className="icon-button" onClick={() => setTab('contacts')}><Plus /></button>
            </header>

            <div className="search">
              <Search size={17} />
              <input
                placeholder="Search conversations"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {filteredChats.map(chat => {
              const uid = chat.members.find(id => id !== user.uid);
              const person = profiles[uid || ''];
              const title = chat.type === 'group' ? chat.groupName : person?.displayName;

              return (
                <button
                  key={chat.id}
                  className={`chat-item ${activeChat?.id === chat.id ? 'selected' : ''}`}
                  onClick={() => setActiveChat(chat)}
                >
                  <div className="avatar">{getInitials(title || 'Veyra')}</div>
                  <span>
                    <b>{title || 'Veyra user'}</b>
                    <small>{chat.lastMessage || 'Start a conversation'}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              );
            })}

            {!filteredChats.length && (
              <div className="empty">
                <MessageCircle size={28} />
                <b>No conversations yet</b>
                <p>Add a contact to start chatting.</p>
                <button className="primary" onClick={() => setTab('contacts')}>Find people</button>
              </div>
            )}
          </section>
        )}

        {tab === 'contacts' && (
          <section className="chat-list">
            <header>
              <div><p className="eyebrow">YOUR PEOPLE</p><h1>Contacts</h1></div>
            </header>

            <div className="add-contact">
              <input
                placeholder="Enter Veyra number"
                value={addNumber}
                onChange={e => setAddNumber(e.target.value)}
              />
              <button className="primary" onClick={addContact} disabled={busy}>
                <Plus size={17} /> Add
              </button>
            </div>

            {contacts.map(contact => (
              <button className="chat-item" key={contact.uid} onClick={() => openChat(contact)}>
                <div className="avatar">{getInitials(contact.displayName)}</div>
                <span>
                  <b>{contact.displayName}</b>
                  <small>Veyra ID · {contact.number}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </section>
        )}

        {tab === 'settings' && (
          <section className="chat-list">
            <header><div><p className="eyebrow">PREFERENCES</p><h1>Settings</h1></div></header>

            <div className="settings-card">
              <div className="avatar large">{getInitials(profile.displayName)}</div>
              <h2>{profile.displayName}</h2>
              <p>@{profile.username}</p>
              <p>Veyra ID: <b>{profile.number}</b></p>
            </div>

            <button className="logout" onClick={logout}>
              <LogOut size={18} /> Log out
            </button>
          </section>
        )}

        {activeChat && tab === 'chats' && (
          <section className="conversation">
            <header className="conversation-header">
              <button className="icon-button back" onClick={() => setActiveChat(null)}>
                <ArrowLeft />
              </button>
              <div className="avatar">{getInitials(otherProfile?.displayName || 'V')}</div>
              <div>
                <b>{otherProfile?.displayName || 'Veyra user'}</b>
                <small>{otherProfile?.online ? 'Online' : 'Veyra'}</small>
              </div>
            </header>

            <div className="messages">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`message ${msg.senderId === user.uid ? 'mine' : ''}`}
                >
                  {msg.type === 'image' && msg.mediaUrl && (
                    <img className="message-image" src={msg.mediaUrl} alt="Shared" />
                  )}
                  {msg.text && <p>{msg.text}</p>}
                  <small>{time(msg.createdAt)} {msg.senderId === user.uid && <CheckCheck size={13} />}</small>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <button type="button" className="icon-button" onClick={() => fileRef.current?.click()}>
                <Image size={19} />
              </button>
              <input
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Write a message..."
              />
              <button className="send" disabled={!message.trim()}>
                <Send size={18} />
              </button>
              <input
                ref={fileRef}
                hidden
                type="file"
                accept="image/*"
                onChange={e => {
                  sendImage(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </form>
          </section>
        )}
      </main>

      {notice && <div className="toast">{notice}</div>}
      <style>{styles}</style>
    </div>
  );
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap');

*{box-sizing:border-box}
body{margin:0;background:#0c0d12;color:#f4f4f7;font-family:'DM Sans',sans-serif}
button,input{font:inherit}
button{cursor:pointer}
.screen{min-height:100vh;display:grid;place-content:center;text-align:center;background:#0c0d12;color:white}
.loader{width:30px;height:30px;border:2px solid #30313b;border-top-color:#b9a2ff;border-radius:50%;animation:spin .8s linear infinite;margin:auto}
@keyframes spin{to{transform:rotate(360deg)}}
.auth-screen{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 0%,#30234a 0%,#15131e 45%,#0b0c11 100%)}
.auth-card{width:min(100%,430px);padding:42px;border:1px solid #ffffff16;border-radius:25px;background:#171820eF;box-shadow:0 30px 100px #0008}
.brand{font:800 32px Manrope,sans-serif;letter-spacing:-2px;margin-bottom:28px}
.brand span{color:#b69aff}
.eyebrow{font-size:10px;letter-spacing:2px;color:#a99bc8;font-weight:700}
h1{font:800 32px Manrope,sans-serif;letter-spacing:-1.5px;margin:8px 0}
.muted{color:#9293a1;font-size:14px;margin-bottom:30px}
.auth-card label{display:block;color:#c9c8d3;font-size:12px;margin:18px 0}
.auth-card input,.add-contact input,.composer input,.search input{display:block;width:100%;border:1px solid #ffffff18;background:#101117;color:white;border-radius:11px;padding:14px;margin-top:8px;outline:none}
input:focus{border-color:#9b80e9!important}
.primary{border:0;border-radius:11px;padding:13px 17px;background:linear-gradient(120deg,#a98af5,#8162d6);color:white;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px}
.auth-card .primary{width:100%;margin-top:25px}
.switch{display:block;margin:22px auto 0;background:none;border:0;color:#bba6f5;font-size:13px}
.app{height:100dvh;display:flex;overflow:hidden;background:#0d0e13}
.sidebar{width:230px;flex-shrink:0;border-right:1px solid #ffffff12;padding:25px 17px;display:flex;flex-direction:column}
.sidebar .brand{padding:0 13px}
.nav{display:grid;gap:7px;margin-top:30px}
.nav button{border:0;background:transparent;color:#8c8d9a;text-align:left;padding:13px;border-radius:10px;display:flex;gap:13px;align-items:center}
.nav button.active,.nav button:hover{background:#9e83e51c;color:#c6b2ff}
.profile-mini{margin-top:auto;border:0;background:#ffffff08;border-radius:13px;padding:12px;color:white;display:flex;gap:10px;align-items:center;text-align:left}
.profile-mini span{font-size:12px}.profile-mini small{display:block;color:#858592;margin-top:3px}
.avatar{width:43px;height:43px;border-radius:14px;background:linear-gradient(135deg,#755eb3,#322d4d);display:grid;place-items:center;font-weight:800;color:white;flex-shrink:0}
.avatar.large{width:75px;height:75px;border-radius:22px;font-size:23px;margin:auto}
.main{display:flex;flex:1;min-width:0}
.chat-list{width:360px;max-width:42%;border-right:1px solid #ffffff12;padding:30px 22px;overflow:auto}
.chat-list header{display:flex;justify-content:space-between;align-items:center;margin-bottom:25px}
.chat-list h1{font-size:27px}
.icon-button{width:39px;height:39px;border:1px solid #ffffff16;background:#ffffff08;color:#ddd;border-radius:12px;display:grid;place-items:center}
.search{display:flex;align-items:center;gap:10px;background:#ffffff08;padding:0 12px;border-radius:11px;color:#888}
.search input{border:0;background:transparent;margin:0;padding:13px 0}
.chat-item{width:100%;display:flex;align-items:center;gap:12px;text-align:left;padding:13px 8px;border:0;border-bottom:1px solid #ffffff0b;background:transparent;color:#eee}
.chat-item:hover,.chat-item.selected{background:#ffffff08;border-radius:12px}
.chat-item span{min-width:0;flex:1}
.chat-item b{display:block;font-size:13px}
.chat-item small{display:block;color:#858592;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{text-align:center;padding:55px 10px;color:#999}
.empty b{display:block;color:#eee;margin:15px 0 5px}
.empty p{font-size:13px;margin-bottom:20px}
.conversation{flex:1;min-width:0;display:flex;flex-direction:column}
.conversation-header{height:78px;flex-shrink:0;border-bottom:1px solid #ffffff12;display:flex;align-items:center;gap:13px;padding:0 25px}
.conversation-header b{font-size:14px}
.conversation-header small{display:block;color:#92929d;margin-top:4px}
.back{display:none}
.messages{flex:1;overflow:auto;padding:25px;display:flex;flex-direction:column;gap:12px}
.message{max-width:min(70%,500px);align-self:flex-start;background:#1d1e28;border:1px solid #ffffff0c;border-radius:5px 16px 16px 16px;padding:11px 14px}
.message.mine{align-self:flex-end;background:#57458a;border-radius:16px 5px 16px 16px}
.message p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.5}
.message small{display:flex;justify-content:flex-end;align-items:center;gap:4px;color:#aaa;font-size:10px;margin-top:7px}
.message-image{max-width:100%;max-height:300px;object-fit:contain;border-radius:9px}
.composer{padding:15px 22px;border-top:1px solid #ffffff12;display:flex;gap:10px;align-items:center}
.composer input{margin:0;flex:1}
.send{width:43px;height:43px;border:0;border-radius:12px;background:#9477df;color:white;display:grid;place-items:center}
.send:disabled{opacity:.4}
.add-contact{display:flex;gap:8px;margin-bottom:20px}
.add-contact input{margin:0;min-width:0}
.settings-card{text-align:center;padding:35px 15px;background:#ffffff08;border:1px solid #ffffff12;border-radius:18px;margin:20px 0}
.settings-card h2{margin-bottom:5px}
.settings-card p{font-size:13px;color:#999}
.logout{display:flex;align-items:center;gap:10px;padding:14px 17px;border:1px solid #ff68682b;background:#ff68680c;color:#ff8989;border-radius:11px}
.toast{position:fixed;bottom:25px;left:50%;transform:translateX(-50%);background:#272431;border:1px solid #ffffff22;color:white;padding:13px 19px;border-radius:12px;z-index:20;box-shadow:0 10px 40px #0008;font-size:13px}
@media(max-width:750px){
.sidebar{width:65px;padding:18px 8px}.sidebar .brand{font-size:0;padding:0 9px}.sidebar .brand span{font-size:30px}.nav button{justify-content:center;font-size:0;padding:13px 8px}.nav button svg{width:21px;height:21px}.profile-mini{justify-content:center;padding:7px}.profile-mini span{display:none}
.chat-list{width:100%;max-width:none;border:0;padding:22px 16px}
.conversation{position:absolute;inset:0 0 0 65px;background:#0d0e13;z-index:3}
.conversation:has(.back){display:flex}
.back{display:grid}
.hide-mobile{display:none}
.auth-card{padding:28px}
}
@media(min-width:751px){.conversation{display:flex}}
`;
