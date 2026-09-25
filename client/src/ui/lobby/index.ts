// Lobbies on the client: the choice at a station (openTableFlow), the live list it shows
// (LobbyWatch over the floor socket), and the party panel at a lobby table (PartyPanel, fed
// through withParty so TableSession needs no changes).
//
// At a station, roughly:
//
//   const choice = await openTableFlow({ game, variant, floor });
//   if (!choice) return;                                   // walked away
//   let session: TableSession;
//   const party = choice.kind === 'lobby'
//     ? new PartyPanel({ me, game, send: (m) => session.send(m), leave: () => session.leave(), sit: () => void session.promptBuyIn() })
//     : null;
//   const module = party ? withParty(GAMES[game], party) : GAMES[game];
//   session = new TableSession({ ...choice, game, variant, station }, module, stage, ui, sfx, onFrame, onClosed);

export { closeTableFlows, openTableFlow, type TableChoice, type TableFlowOpts } from './flow.ts';
export { PartyPanel, withParty, type PartyPanelOpts } from './party.ts';
// v6 invite6: invites to a lobby table (the cards, the picker, joining)
export { InviteHub, type InviteApp, type InviteFloor } from './invites.ts';
export { LobbyWatch, sortLobbies, type LobbyFloor } from './watch.ts';
