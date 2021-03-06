import {GraphQLID, GraphQLNonNull} from 'graphql'
import {SubscriptionChannel} from 'parabol-client/types/constEnums'
import {TierEnum} from 'parabol-client/types/graphql'
import stripe from '../../billing/stripe'
import getRethink from '../../database/rethinkDriver'
import {getUserId, isSuperUser, isUserBillingLeader} from '../../utils/authorization'
import publish from '../../utils/publish'
import segmentIo from '../../utils/segmentIo'
import setUserTierForOrgId from '../../utils/setUserTierForOrgId'
import standardError from '../../utils/standardError'
import DowngradeToPersonalPayload from '../types/DowngradeToPersonalPayload'

export default {
  type: DowngradeToPersonalPayload,
  description: 'Downgrade a paid account to the personal service',
  args: {
    orgId: {
      type: new GraphQLNonNull(GraphQLID),
      description: 'the org requesting the upgrade'
    }
  },
  async resolve(_source, {orgId}, {authToken, dataLoader, socketId: mutatorId}) {
    const r = await getRethink()
    const now = new Date()
    const operationId = dataLoader.share()
    const subOptions = {mutatorId, operationId}

    // AUTH
    const viewerId = getUserId(authToken)
    if (!isSuperUser(authToken)) {
      if (!(await isUserBillingLeader(viewerId, orgId, dataLoader))) {
        return standardError(new Error('Not organization leader'), {userId: viewerId})
      }
    }

    // VALIDATION
    const {stripeSubscriptionId, tier} = await r
      .table('Organization')
      .get(orgId)
      .run()

    if (tier === TierEnum.personal) {
      return standardError(new Error('Already on free tier'), {userId: viewerId})
    }

    // RESOLUTION
    // if they downgrade & are re-upgrading, they'll already have a stripeId
    try {
      await stripe.subscriptions.del(stripeSubscriptionId)
    } catch (e) {
      console.log(e)
    }

    const {teamIds} = await r({
      org: r
        .table('Organization')
        .get(orgId)
        .update({
          tier: TierEnum.personal,
          periodEnd: now,
          stripeSubscriptionId: null,
          updatedAt: now
        }),
      teamIds: (r
        .table('Team')
        .getAll(orgId, {index: 'orgId'})
        .update(
          {
            tier: TierEnum.personal,
            isPaid: true,
            updatedAt: now
          },
          {returnChanges: true}
        )('changes')('new_val')('id')
        .default([]) as unknown) as string[]
    }).run()

    await setUserTierForOrgId(orgId)
    segmentIo.track({
      userId: viewerId,
      event: 'Downgrade to personal',
      properties: {
        orgId
      }
    })
    const data = {orgId, teamIds}
    publish(SubscriptionChannel.ORGANIZATION, orgId, 'DowngradeToPersonalPayload', data, subOptions)

    teamIds.forEach((teamId) => {
      // I can't readily think of a clever way to use the data obj and filter in the resolver so I'll reduce here.
      // This is probably a smelly piece of code telling me I should be sending this per-viewerId or per-org
      const teamData = {orgId, teamIds: [teamId]}
      publish(SubscriptionChannel.TEAM, teamId, 'DowngradeToPersonalPayload', teamData, subOptions)
    })
    return data
  }
}
