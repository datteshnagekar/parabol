import {GraphQLInt, GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLID} from 'graphql'
import {IActionMeeting, MeetingTypeEnum} from 'parabol-client/types/graphql'
import toTeamMemberId from 'parabol-client/utils/relay/toTeamMemberId'
import {getUserId} from '../../utils/authorization'
import filterTasksByMeeting from '../../utils/filterTasksByMeeting'
import {GQLContext} from '../graphql'
import ActionMeetingMember from './ActionMeetingMember'
import ActionMeetingSettings from './ActionMeetingSettings'
import NewMeeting, {newMeetingFields} from './NewMeeting'
import Task from './Task'
import AgendaItem from './AgendaItem'

const ActionMeeting = new GraphQLObjectType<IActionMeeting, GQLContext>({
  name: 'ActionMeeting',
  interfaces: () => [NewMeeting],
  description: 'An action meeting',
  fields: () => ({
    ...newMeetingFields(),
    meetingMembers: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ActionMeetingMember))),
      description: 'The team members that were active during the time of the meeting',
      resolve: ({id: meetingId}, _args, {dataLoader}) => {
        return dataLoader.get('meetingMembersByMeetingId').load(meetingId)
      }
    },
    settings: {
      type: new GraphQLNonNull(ActionMeetingSettings),
      description: 'The settings that govern the action meeting',
      resolve: async ({teamId}, _args, {dataLoader}) => {
        const allSettings = await dataLoader.get('meetingSettingsByTeamId').load(teamId)
        return allSettings.find((settings) => settings.meetingType === MeetingTypeEnum.action)
      }
    },
    taskCount: {
      type: new GraphQLNonNull(GraphQLInt),
      description: 'The number of tasks generated in the meeting',
      resolve: async ({id: meetingId, taskCount}, _args, {authToken, dataLoader}) => {
        if (Number.isFinite(taskCount)) return taskCount
        const viewerId = getUserId(authToken)
        const meeting = await dataLoader.get('newMeetings').load(meetingId)
        const {teamId} = meeting
        const teamTasks = await dataLoader.get('tasksByTeamId').load(teamId)
        return filterTasksByMeeting(teamTasks, meetingId, viewerId).length
      }
    },
    tasks: {
      type: new GraphQLNonNull(GraphQLList(GraphQLNonNull(Task))),
      description: 'The tasks created within the meeting',
      resolve: async ({id: meetingId}, _args, {authToken, dataLoader}) => {
        const viewerId = getUserId(authToken)
        const meeting = await dataLoader.get('newMeetings').load(meetingId)
        const {teamId} = meeting
        const teamTasks = await dataLoader.get('tasksByTeamId').load(teamId)
        return filterTasksByMeeting(teamTasks, meetingId, viewerId)
      }
    },
    viewerMeetingMember: {
      type: new GraphQLNonNull(ActionMeetingMember),
      description: 'The action meeting member of the viewer',
      resolve: ({id: meetingId}, _args, {authToken, dataLoader}) => {
        const viewerId = getUserId(authToken)
        const meetingMemberId = toTeamMemberId(meetingId, viewerId)
        return dataLoader.get('meetingMembers').load(meetingMemberId)
      }
    },
    agendaItem: {
      type: AgendaItem,
      description: 'A single agenda item',
      args: {
        agendaItemId: {
          type: GraphQLNonNull(GraphQLID)
        }
      },
      resolve: async ({id: meetingId}, {agendaItemId}, {dataLoader}) => {
        const agendaItem = await dataLoader.get('agendaItems').load(agendaItemId)
        if (agendaItem.meetingId !== meetingId) return null
        return agendaItem
      }
    }
  })
})

export default ActionMeeting
