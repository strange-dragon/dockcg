import { BeanModel } from "redbean-node/dist/bean-model";
import { R } from "redbean-node";
import { LooseObject } from "../../common/util-common";

export class Registry extends BeanModel {

    /**
     * All registries of this Dockge instance, oldest first.
     *
     * redbean prepends its own `where` fragment, so an empty clause is used
     * here and the ordering is applied in memory (same style as agent.ts).
     */
    static async getRegistryList() : Promise<Registry[]> {
        const list = await R.findAll("registry") as Registry[];
        return list.sort((a, b) => Number(a.id) - Number(b.id));
    }

    /**
     * Never expose the (encrypted) password to the client.
     */
    toJSON() : LooseObject {
        return {
            id: this.id,
            name: this.name,
            url: this.url,
            username: this.username,
            createdDate: this.createdDate,
            hasPassword: !!this.password,
        };
    }
}

export default Registry;
